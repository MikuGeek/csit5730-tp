# CSIT5730: Course Project

Shuai Wang

## Logistics

- 10-12 – Group project topics introduction
- 10-12 ~ 10-19 – Express grouping intention and project intention
  - Please send our TAs (wkwongal@connect.ust.hk) an email and copy me (shuaiw@cse.ust.hk)
- When I believe your proposed project needs some tweaks (see later slides), I will let you know
- We expect you to form a group of 3~5 students
  - We have 41 people in total, so ideally we're looking at around 10 groups. If things end up feeling particularly unbalanced, we can always adjust later.
- 10-21 – Confirm groups and project
  - We might tweak if you were not in any group
- 11-30 – project presentation
  - Will provide feedback for you to further concretize your project
- 12-15 – project package submission
  - Presentation slides; code
  - Final grading needs to be submitted to University at about 12-23

## Group Project topic introduction

- We tried to keep each project with comparable difficulty and workload, in our best effort.
  - Some of the topics may not be introduced in the lecture yet; requiring some self-studies.
- Expect reasonable amount of engineering efforts
  - Write some code, or reuse some existing tools
  - Launching experiments to quantify the results achieved

It is totally fine if you cannot fully finish the project in the end; all in all, we look at your effort, and do grading based on the difficulty of the project.

## Project Topics

### Suggestion 2: eBPF-based Intrusion Detection System

- **Background**: eBPF (extended Berkeley Packet Filter) allows the user to run programs inside the kernel in an event-driven mode. It provides powerful observability into the kernel-space.
- **Topic**: you are suggested to design and implement an IDS (intrusion detection system) upon eBPF.
- **Code**: you need to write a set of eBPF programs that monitor system events, e.g., syscall, and incorporate them into one IDS. Your IDS should warn the user when an anomaly is detected.
- **Evaluation** (suggested plan): evaluate based on #anomaly/event supported and the performance overhead brought by your detection system.

## Other Suggestions

- **Background**: You can propose your own group project, if that appears better.
- **Topic**: related to AI x computer security and privacy. Should not be a simple "app development".
