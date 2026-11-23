CC ?= cc
CLANG ?= clang
BPFTOOL ?= bpftool
MULTIARCH ?= $(shell $(CC) -dumpmachine)
CFLAGS ?= -O2 -g -Wall -Wextra -Werror

.PHONY: all test clean
all: build/reader build/workload

build:
	mkdir -p $@

build/probes.bpf.o: ids/probes.bpf.c ids/event.h | build
	$(CLANG) -target bpf -I/usr/include/$(MULTIARCH) $(CFLAGS) -c $< -o $@

build/probes.skel.h: build/probes.bpf.o
	$(BPFTOOL) gen skeleton $< > $@.tmp && mv $@.tmp $@

build/reader: ids/reader.c ids/event.h build/probes.skel.h
	$(CC) $(CFLAGS) -Ibuild $< -lbpf -o $@

build/workload: ids/workload.c ids/event.h | build
	$(CC) $(CFLAGS) $< -o $@

test:
	python3 -m unittest discover -s tests -v
	npm test

clean:
	$(RM) -r build
