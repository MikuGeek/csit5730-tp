#include <linux/bpf.h>
#include <bpf/bpf_core_read.h>
#include <bpf/bpf_endian.h>
#include <bpf/bpf_helpers.h>
#include "event.h"

struct qstr { const unsigned char *name; } __attribute__((preserve_access_index));
struct dentry { struct qstr d_name; } __attribute__((preserve_access_index));
struct path { struct dentry *dentry; } __attribute__((preserve_access_index));
struct file { struct path f_path; } __attribute__((preserve_access_index));
struct mm_struct { struct file *exe_file; } __attribute__((preserve_access_index));
struct task_struct {
    int tgid;
    __u64 start_boottime;
    struct task_struct *group_leader;
    struct task_struct *real_parent;
    struct mm_struct *mm;
} __attribute__((preserve_access_index));
struct trace_event_raw_sys_enter {
    unsigned long args[6];
} __attribute__((preserve_access_index));

struct sockaddr_ipv4 { __u16 family, port; __u8 address[4], padding[8]; };
struct sockaddr_ipv6 { __u16 family, port; __u32 flow; __u8 address[16]; __u32 scope; };

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, RING_BYTES);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, 1);
    __type(key, __u32);
    __type(value, __u64);
} dropped SEC(".maps");

const volatile __u64 scope_cgroup;

static __always_inline int in_scope(void)
{
    return !scope_cgroup || bpf_get_current_cgroup_id() == scope_cgroup;
}

static __always_inline struct event *reserve(enum event_kind kind, struct task_struct *task)
{
    struct event *entry = bpf_ringbuf_reserve(&events, sizeof(*entry), 0);
    if (!entry) {
        __u32 index = 0;
        __u64 *lost = bpf_map_lookup_elem(&dropped, &index);
        if (lost)
            __sync_fetch_and_add(lost, 1);
        return 0;
    }
    __builtin_memset(entry, 0, sizeof(*entry));
    entry->time_ns = bpf_ktime_get_ns();
    entry->kind = kind;
    entry->tgid = bpf_get_current_pid_tgid() >> 32;
    entry->start_ns = BPF_CORE_READ(task, group_leader, start_boottime);
    return entry;
}

static __always_inline void image_name(struct task_struct *task, char name[NAME_BYTES])
{
    const unsigned char *source = BPF_CORE_READ(task, mm, exe_file, f_path.dentry, d_name.name);
    long length = bpf_probe_read_kernel_str(name, NAME_BYTES, source);
    if (length <= 1 || length >= NAME_BYTES)
        name[0] = '\0';
}

SEC("tp/sched/sched_process_exec")
int trace_exec(void *ctx)
{
    (void)ctx;
    if (!in_scope())
        return 0;
    struct task_struct *task = (void *)bpf_get_current_task();
    struct event *entry = reserve(EXEC, task);
    if (!entry)
        return 0;
    struct task_struct *parent = BPF_CORE_READ(task, real_parent, group_leader);
    entry->parent_tgid = BPF_CORE_READ(parent, tgid);
    entry->parent_start_ns = BPF_CORE_READ(parent, start_boottime);
    image_name(task, entry->image);
    image_name(parent, entry->parent_image);
    bpf_ringbuf_submit(entry, 0);
    return 0;
}

SEC("tp/syscalls/sys_enter_connect")
int trace_connect(struct trace_event_raw_sys_enter *ctx)
{
    if (!in_scope())
        return 0;
    const void *user_address = (const void *)ctx->args[1];
    int length = (int)ctx->args[2];
    __u16 family;
    if (length < (int)sizeof(family) || bpf_probe_read_user(&family, sizeof(family), user_address))
        return 0;

    __u8 address[16] = {};
    __u16 port;
    if (family == 2 && length >= (int)sizeof(struct sockaddr_ipv4)) {
        struct sockaddr_ipv4 ipv4;
        if (bpf_probe_read_user(&ipv4, sizeof(ipv4), user_address) || ipv4.family != family)
            return 0;
        port = ipv4.port;
        __builtin_memcpy(address, ipv4.address, sizeof(ipv4.address));
    } else if (family == 10 && length >= (int)sizeof(struct sockaddr_ipv6)) {
        struct sockaddr_ipv6 ipv6;
        if (bpf_probe_read_user(&ipv6, sizeof(ipv6), user_address) || ipv6.family != family)
            return 0;
        port = ipv6.port;
        __builtin_memcpy(address, ipv6.address, sizeof(ipv6.address));
    } else {
        return 0;
    }

    struct task_struct *task = (void *)bpf_get_current_task();
    struct event *entry = reserve(CONNECT, task);
    if (!entry)
        return 0;
    entry->family = family;
    entry->port = bpf_ntohs(port);
    __builtin_memcpy(entry->address, address, sizeof(address));
    bpf_ringbuf_submit(entry, 0);
    return 0;
}

SEC("tp/syscalls/sys_enter_openat")
int trace_openat(struct trace_event_raw_sys_enter *ctx)
{
    if (!in_scope())
        return 0;
    const char expected[] = CANARY_PATH;
    char path[sizeof(expected) + 1];
    if (bpf_probe_read_user_str(path, sizeof(path), (void *)ctx->args[1]) != sizeof(expected))
        return 0;
#pragma unroll
    for (unsigned int index = 0; index < sizeof(expected); index++) {
        if (path[index] != expected[index])
            return 0;
    }
    struct task_struct *task = (void *)bpf_get_current_task();
    struct event *entry = reserve(CANARY, task);
    if (entry)
        bpf_ringbuf_submit(entry, 0);
    return 0;
}

char LICENSE[] SEC("license") = "Dual MIT/GPL";
