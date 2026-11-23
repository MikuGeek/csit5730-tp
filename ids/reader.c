#include <errno.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <time.h>
#include <bpf/bpf.h>
#include "event.h"
#include "probes.skel.h"

static volatile sig_atomic_t stopping;

struct capture {
    bool drain;
    unsigned long long count[4];
};

static void stop(int signo)
{
    (void)signo;
    stopping = 1;
}

static int sample(void *context, void *data, size_t size)
{
    struct capture *capture = context;
    const struct event *entry = data;
    if (size != sizeof(*entry) || entry->kind < EXEC || entry->kind > CANARY)
        return -EINVAL;
    capture->count[entry->kind]++;
    if (!capture->drain && fwrite(entry, size, 1, stdout) != 1)
        return -EIO;
    return 0;
}

static int report_loss(int fd, __u64 *per_cpu, int cpus, __u64 *previous, bool drain, __u64 time_ns)
{
    __u32 index = 0;
    __u64 drops = 0;
    if (bpf_map_lookup_elem(fd, &index, per_cpu))
        return -errno;
    for (int cpu = 0; cpu < cpus; cpu++)
        drops += per_cpu[cpu];
    if ((drops != *previous || time_ns) && !drain) {
        struct event entry = { .kind = CAPTURE_STATS, .start_ns = drops, .time_ns = time_ns };
        if (fwrite(&entry, sizeof(entry), 1, stdout) != 1)
            return -EIO;
    }
    *previous = drops;
    return 0;
}

int main(int argc, char **argv)
{
    struct capture capture = {0};
    unsigned long long cgroup = 0;
    for (int index = 1; index < argc; index++) {
        if (!strcmp(argv[index], "--drain")) {
            capture.drain = true;
        } else if (!strcmp(argv[index], "--cgroup") && index + 1 < argc) {
            char *end;
            const char *value = argv[++index];
            errno = 0;
            cgroup = strtoull(value, &end, 10);
            if (errno || *end || !cgroup || *value < '0' || *value > '9')
                return 2;
        } else {
            fprintf(stderr, "usage: %s [--drain] [--cgroup ID]\n", argv[0]);
            return 2;
        }
    }

    struct sigaction action = { .sa_handler = stop };
    sigemptyset(&action.sa_mask);
    sigaction(SIGINT, &action, NULL);
    sigaction(SIGTERM, &action, NULL);
    signal(SIGPIPE, SIG_IGN);

    int error = -ENOMEM;
    int cpus = libbpf_num_possible_cpus();
    if (cpus < 1)
        return 1;
    __u64 *per_cpu = calloc((size_t)cpus, sizeof(*per_cpu));
    __u64 drops = 0;
    struct ring_buffer *ring = NULL;
    struct probes_bpf *probes = probes_bpf__open();
    if (!probes || !per_cpu)
        goto cleanup;
    probes->rodata->scope_cgroup = cgroup;
    if ((error = probes_bpf__load(probes)))
        goto cleanup;
    ring = ring_buffer__new(bpf_map__fd(probes->maps.events), sample, &capture, NULL);
    if (!ring) {
        error = -errno;
        goto cleanup;
    }
    if ((error = probes_bpf__attach(probes)))
        goto cleanup;

    int drops_fd = bpf_map__fd(probes->maps.dropped);
    fprintf(stderr, "READY\n");
    while (!stopping) {
        struct timespec before_poll;
        clock_gettime(CLOCK_MONOTONIC, &before_poll);
        int polled = ring_buffer__poll(ring, 100);
        if (polled < 0 && polled != -EINTR) {
            error = polled;
            break;
        }
        __u64 watermark = polled == 0 ? (__u64)before_poll.tv_sec * 1000000000 + before_poll.tv_nsec : 0;
        error = report_loss(drops_fd, per_cpu, cpus, &drops, capture.drain, watermark);
        if (error || fflush(stdout)) {
            if (!error)
                error = -EIO;
            break;
        }
    }
    probes_bpf__detach(probes);
    if (!error && ring_buffer__consume(ring) < 0)
        error = -EIO;
    if (!error)
        error = report_loss(drops_fd, per_cpu, cpus, &drops, capture.drain, 0);
    if (fflush(stdout) && !error)
        error = -EIO;

    struct rusage usage;
    if (!getrusage(RUSAGE_SELF, &usage)) {
        double cpu_ms = (usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) * 1000.0 +
                        (usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1000.0;
        fprintf(stderr, "{\"reader_cpu_ms\":%.3f,\"reader_peak_rss_kib\":%ld,"
                "\"exec\":%llu,\"connect\":%llu,\"canary\":%llu,\"drops\":%llu,"
                "\"bpf_map_payload_bytes\":%zu}\n", cpu_ms, usage.ru_maxrss,
                capture.count[EXEC], capture.count[CONNECT], capture.count[CANARY], drops,
                RING_BYTES + sizeof(__u64) * ((size_t)cpus + 1));
    }
cleanup:
    if (error)
        fprintf(stderr, "reader: %s\n", strerror(-error));
    ring_buffer__free(ring);
    probes_bpf__destroy(probes);
    free(per_cpu);
    return error ? 1 : 0;
}
