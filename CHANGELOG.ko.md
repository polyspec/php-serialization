<!-- doc-id: changelog -->
<!-- source-sha256: 931922b7dcb4074211252cd8f766503c84c3dfe6340bf53ab877b044cc922824 -->
# 변경 기록

[English](CHANGELOG.md)

<a id="unreleased"></a>
## Unreleased
- Makefile이 repository의 recipe를 담고 설치된 kit의 utility를 실행한다. npm, mise, uv, ruff, vulture, oxlint, knip의 설정은 각자의 file에 있고, kit이 쓰던 사본은 repository의 file이 되었거나 없어졌다(T1.4).
- fuzz 실행은 process가 사라진 실행의 디렉터리를 지우므로, 강제 종료된 실행이 약 216 MB를 임시 디렉터리에 영구히 남기지 않는다(T1.3).

## 0.0.1

- php-serialize 0.0.1은 첫 release입니다. Node.js와 Python용 PHP serialize 형식입니다 (T1.2).
- T1.1: php-src에서 포팅한 Node.js와 Python용 PHP serialize 형식. 실제 PHP가 쓰는 contract와 PHP를 기준으로 하는 fuzz를 포함합니다 (T1.1).
