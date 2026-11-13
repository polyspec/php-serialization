<!-- doc-id: development -->
<!-- source-sha256: d0e1b4d9b4700c22fd8bafc92a2c4ef2ca3e28be9523851dea5939856b42c973 -->
# 개발 절차

[English](AGENTS.md)

모든 polyspec repository의 작업 원칙은 kit의 [PRINCIPLES.ko.md](https://github.com/polyspec/kit/blob/main/PRINCIPLES.ko.md)에 있습니다. 이 문서는 이 repository의 규칙만 적습니다.

<a id="reference"></a>
## 기준

- Own: 형식의 기준은 PHP입니다. PHP와 다르면 패키지의 결함입니다. 일부러 거부하는 입력은 [명세](docs/spec/php-serialize.ko.md#refused)와 contract의 `stricter`, `refused_values` 항목에 적습니다.
  Enforced by: `make contracts-check`, `make fuzz`
- Own: 기록은 형식의 출처로 PHP만 적고 이 repository만 설명합니다.
  Enforced by: none, 기록의 표현은 판단입니다.
- Own: contract는 실제 PHP가 쓴 데이터를 담고 언어별 형태를 담지 않으므로, 새 runtime은 `packages/` 아래의 새 패키지입니다.
  Enforced by: none, 안내 규칙: kit은 구현들이 서로 어떻게 관계되는지 검사하지 않으며, 각 저장소가 자기 테스트를 실행한다(K1129)

<a id="layout"></a>
## 배치

- Own: 이행 기간의 S6 예외: `legacy/packages/js`와 `legacy/packages/python`은 생성된 바인딩이 대체하는 Node.js와 Python 패키지를 담습니다. 배포 대상이 아니며, 그 언어의 바인딩이 contract, 패키지 시험, fuzz를 통과하면 각각 그것만의 변경으로 없앱니다([이행](docs/spec/php-serialize.ko.md#transition), 계획 V-6 (5)).
  Enforced by: `make layout-check`, `make release-coverage`
- Own: 모든 계약이 적는 다섯 target(binding BD-27)의 바인딩 패키지 `packages/python`, `packages/ts`, `packages/ts/wasm`, `packages/php-ext`, 그리고 C ABI crate `packages/go/internal/ffi`를 가진 `packages/go`는 `binding scaffold`가 `packages/rust/interface.json`에서 쓰는 그대로이며, 그 `generated/`는 추적하지 않습니다. 루트 Cargo workspace가 코어 crate와 함께 그것들을 담고, 코어의 Rust 레시피는 코어 package를 이름으로 지정합니다.
  Enforced by: `make bindings-check`

<a id="tools"></a>
## 도구

- Own: recipe는 이 repository의 것입니다. `Makefile`은 release asset에 고정한 npm 패키지 `@polyspec/kit`의 utility를 명시적 인자로 실행하고, 각 도구는 자기 file(`.npmrc`, `mise.toml`, `ruff.toml`, `.oxlintrc.json`, `knip.json`)에서 설정을 읽습니다. kit은 여기에 recipe를 include하지 않고 file을 쓰지 않습니다.
  Enforced by: none, recipe가 어떤 utility를 실행할지는 이 repository가 정합니다.
- Own: 개발 중에는 변경을 담당하는 Red/Green unit test를 실행합니다. 전체 suite는 `main`의 모든 push에서 CI가 실행합니다.
  Enforced by: none, 로컬 실행은 도구가 관찰하지 않습니다.
