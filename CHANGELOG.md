<!-- doc-id: changelog -->
# Changelog

[한국어](CHANGELOG.ko.md)

<a id="unreleased"></a>
## Unreleased
- A fuzz run removes the directories of the runs whose process is gone, so a killed run no longer leaves about 216 MB in the temporary directory for good (T1.3).

## 0.0.1

- php-serialize 0.0.1 is the first release: the serialize format of PHP for Node.js and Python (T1.2).
- T1.1: the serialize format of PHP for Node.js and Python, ported from php-src, with a contract that real PHP writes and a fuzz with PHP as the reference (T1.1).
