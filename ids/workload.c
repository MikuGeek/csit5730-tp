#include <arpa/inet.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
#include "event.h"

int main(int argc, char **argv)
{
    if (argc == 4 && !strcmp(argv[1], "launch")) {
        pid_t child = fork();
        if (child < 0)
            return 1;
        if (!child) {
            execl(argv[2], argv[2], argv[3], NULL);
            perror("execl");
            _exit(1);
        }
        int status;
        return waitpid(child, &status, 0) == child && WIFEXITED(status) ? WEXITSTATUS(status) : 1;
    }
    if (argc != 2)
        return 2;
    if (!strcmp(argv[1], "canary")) {
        int fd = openat(AT_FDCWD, CANARY_PATH, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
        if (fd >= 0)
            close(fd);
        return 0;
    }
    int alternate = !strcmp(argv[1], "alternate");
    int duplicates = !strcmp(argv[1], "duplicates");
    if (!alternate && !duplicates && strcmp(argv[1], "routine"))
        return 2;
    for (unsigned int index = 0; index < 8; index++) {
        int family = index % 2 ? AF_INET6 : AF_INET;
        int fd = socket(family, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
        if (fd < 0) {
            perror("socket");
            return 1;
        }
        unsigned short port = 39100 + 20 * alternate + (duplicates ? index % 2 : index);
        if (family == AF_INET6) {
            const struct sockaddr_in6 endpoint = {
                .sin6_family = AF_INET6, .sin6_addr = IN6ADDR_LOOPBACK_INIT, .sin6_port = htons(port),
            };
            (void)connect(fd, (const struct sockaddr *)&endpoint, sizeof(endpoint));
        } else {
            const struct sockaddr_in endpoint = {
                .sin_family = AF_INET, .sin_addr.s_addr = htonl(INADDR_LOOPBACK), .sin_port = htons(port),
            };
            (void)connect(fd, (const struct sockaddr *)&endpoint, sizeof(endpoint));
        }
        close(fd);
    }
    return 0;
}
