<!-- doc-id: plan-execution -->
# Execution plan

[한국어](plan.ko.md)

<a id="wave-1"></a>
## Wave 1 — First release

A server in another language reads the data of PHP only if the format behaves as PHP does at every byte. T1.1 ports the format from the source of PHP to Node.js and Python, proves it with a contract that real PHP writes and a fuzz against PHP, and sets up the repository with kit. T1.2 releases it. The exit criterion is a green CI run on `main` and the release assets of its commit.
