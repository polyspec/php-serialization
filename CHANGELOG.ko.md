<!-- doc-id: changelog -->
<!-- source-sha256: e7287833d4ccd9fe1eef730f2e74f9b2080d9a1c384500af692ead0371e30e91 -->
# 변경 기록

[English](CHANGELOG.md)

<a id="unreleased"></a>
## Unreleased

- 저장소는 run-tests의 시간 제한을 없앤 kit 0.0.105(kit K1175)를 채택하고 run-tests에 `--timeout`을 넘기지 않는다(T1.14).

## 0.0.5

- 저장소는 kit이 조용히 버리던 출력, 오류, 실패를 남기는 kit 0.0.103(kit K1136–K1165)를 채택한다(T1.12).

## 0.0.4

- 저장소는 설치가 실패하면 uv-install이 provider 링크를 되돌리는 kit 0.0.102에서 실행된다(T1.10, T1.11).
- php-serialize는 설치가 실패하면 uv-install이 provider 링크를 되돌리는 kit 0.0.102를 채택한다. recipe 줄은 바뀌지 않는다(T1.10).

## 0.0.3

- repository는 parity 없이 kit 0.0.101을 실행한다. config/parity.json과 그 target은 kit 0.0.100과 함께 없어졌다(T1.7, T1.8).
- repository는 kit 0.0.99를 실행하고, kit 0.0.98이 정해 두던 모든 값을 넘기므로 각 target은 같은 명령과 시험을 실행한다. make kit-check는 kit 0.0.99와 함께 없어졌다(T1.6).

## 0.0.2

- Makefile이 repository의 recipe를 담고 설치된 kit의 utility를 실행한다. npm, mise, uv, ruff, vulture, oxlint, knip의 설정은 각자의 file에 있고, kit이 쓰던 사본은 repository의 file이 되었거나 없어졌다(T1.4).
- fuzz 실행은 process가 사라진 실행의 디렉터리를 지우므로, 강제 종료된 실행이 약 216 MB를 임시 디렉터리에 영구히 남기지 않는다(T1.3).

## 0.0.1

- php-serialize 0.0.1은 첫 release입니다. Node.js와 Python용 PHP serialize 형식입니다 (T1.2).
- T1.1: php-src에서 포팅한 Node.js와 Python용 PHP serialize 형식. 실제 PHP가 쓰는 contract와 PHP를 기준으로 하는 fuzz를 포함합니다 (T1.1).
