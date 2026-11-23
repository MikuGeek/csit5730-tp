CC ?= cc
CLANG ?= clang
BPFTOOL ?= bpftool
MULTIARCH ?= $(shell $(CC) -dumpmachine)
CFLAGS ?= -O2 -g -Wall -Wextra -Werror
BPF_CPPFLAGS ?= -I/usr/include/$(MULTIARCH)
BUILD_DIR ?= build

.PHONY: all test clean
all: $(BUILD_DIR)/reader $(BUILD_DIR)/workload

$(BUILD_DIR):
	mkdir -p $@

$(BUILD_DIR)/probes.bpf.o: ids/probes.bpf.c ids/event.h | $(BUILD_DIR)
	$(CLANG) -target bpf $(BPF_CPPFLAGS) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/probes.skel.h: $(BUILD_DIR)/probes.bpf.o
	$(BPFTOOL) gen skeleton $< > $@.tmp && mv $@.tmp $@

$(BUILD_DIR)/reader: ids/reader.c ids/event.h $(BUILD_DIR)/probes.skel.h
	$(CC) $(CPPFLAGS) $(CFLAGS) -I$(BUILD_DIR) $(LDFLAGS) $< -lbpf -o $@

$(BUILD_DIR)/workload: ids/workload.c ids/event.h | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) $(LDFLAGS) $< -o $@

test:
	python3 -m unittest discover -s tests -v
	npm test

clean:
	$(RM) -r -- "$(BUILD_DIR)"
