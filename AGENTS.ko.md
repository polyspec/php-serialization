<!-- doc-id: development -->
<!-- source-sha256: 537f534af3fdcdbaa37aa6cf8335ca6162d72d42272ebf573687278fe7e93c26 -->
# 개발 절차

[English](AGENTS.md)

모든 polyspec repository의 작업 원칙은 [PRINCIPLES.ko.md](PRINCIPLES.ko.md)에 있습니다. 이 문서는 이 repository의 규칙만 적습니다.

<a id="reference"></a>
## 기준

- Own: 형식의 기준은 PHP입니다. PHP와 다르면 패키지의 결함입니다. 일부러 거부하는 입력은 [명세](docs/spec/php-serialize.ko.md#refused)와 contract의 `stricter` 항목에 적습니다.
  Enforced by: `make contracts-check`, `make fuzz`
- Own: 기록은 형식의 출처로 PHP만 적고 이 repository만 설명합니다.
  Enforced by: none, 기록의 표현은 판단입니다.
- Own: contract는 실제 PHP가 쓴 데이터만 담고 언어별 형태를 담지 않습니다. 새 runtime은 `packages/` 아래의 새 패키지와 `config/parity.json`의 항목 하나입니다.
  Enforced by: `make parity-declarations-check`

<a id="tools"></a>
## 도구

- Own: 공유 도구는 release asset에 고정한 npm 패키지 `@polyspec/kit`에서 옵니다. `kit.copies`의 사본은 `make kit-sync`가 쓰며 여기서 수정하지 않습니다.
  Enforced by: `make kit-check`
- Own: 개발 중에는 변경을 담당하는 Red/Green unit test만 실행합니다. 전체 suite는 `main`의 모든 push에서 CI가 실행합니다.
  Enforced by: none, 로컬 실행은 도구가 관찰하지 않습니다.
