#ifndef TRACETRIAGE_EVENT_H
#define TRACETRIAGE_EVENT_H

#include <linux/types.h>

#define CANARY_PATH "/run/tracetriage-canary"
#define NAME_BYTES 32
#define RING_BYTES (1U << 20)

enum event_kind { CAPTURE_STATS, EXEC, CONNECT, CANARY };

struct event {
    __u64 time_ns;
    __u64 start_ns;
    __u64 parent_start_ns;
    __u32 kind;
    __u32 tgid;
    __u32 parent_tgid;
    __u16 family;
    __u16 port;
    __u8 address[16];
    char image[NAME_BYTES];
    char parent_image[NAME_BYTES];
};

_Static_assert(sizeof(struct event) == 120, "unexpected event layout");

#endif
