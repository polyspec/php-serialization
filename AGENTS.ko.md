<!-- doc-id: development -->
<!-- source-sha256: e32970cfe02bede3bae84451f1f7382ea513f8f47184fbf0c6477d21dc6455a6 -->
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

<a id="bindings"></a>
## 바인딩

- Own: `make bindings`는 다섯 target을 각각 자기 target `make bindings-<target>`(`binding generate --target <target>`)에서 생성하고, 바인딩을 빌드하거나 시험하는 모든 make target은 자기가 쓰는 target의 생성을 먼저 실행합니다. 그래서 binding이 거부하는 target은 자기 이름으로 실패하고 다른 target을 멈추지 않습니다(binding GN-1c). 바인딩 crate는 feature `panic-test`와 `fault-test`로 빌드합니다. core의 결함 주입점은 core의 feature `fault-test`가 있을 때만 살아 있기 때문입니다(binding GN-5). core의 시험은 그 feature를 켠 core 자신에 의존합니다(`packages/rust/Cargo.toml`의 `[dev-dependencies]`). `make test-bindings`는 workspace 전체에 clippy를, `make check-declarations`를 실행한 뒤 `make test-python-binding`, `make test-node`, `make test-wasm`, `make test-php`, `make test-go`를 실행합니다. 계약의 다섯 target마다 하나이며, 각각 binding이 생성하는 시험과 그 바인딩의 계약 case를 그 언어의 표준 runner에서 실행합니다: unittest, node --test(Node와 WASM, WASM 바인딩은 같은 설치 패키지의 subpath `./wasm`으로), PHPUnit, go test. 계약 case는 `packages/python/tests`, `packages/ts/tests/cases.mjs`를 함께 쓰는 `packages/ts/tests/cases.test.mjs`와 `packages/ts/tests/cases.wasm.test.mjs`, 그리고 `packages/php-ext/tests`입니다. 각각 실패하지 않는 모든 case의 결과를 그 `value`와 bytes와 비교하고, 실패하는 모든 case의 class, kind, status를 비교합니다. Go는 아직 계약 case가 없습니다. binding에 `php_value`의 Go 형식이 없고 Go에서 class unit을 거부하므로(binding GN-1, T-5), runner가 있지 않은 타입을 이름으로 쓰게 되기 때문입니다. 생성기가 받지 못하는 target은 원인과 함께 실패하는 target으로 남고, 어떤 target도 빼거나 건너뛰지 않습니다(binding BD-27). `make test-python`은 legacy Python 패키지가 없어질 때까지 그 시험을 실행합니다.
  Enforced by: none, binding이 계약의 class unit을 거부하는 동안 `make test-bindings`는 CI의 target이 아닙니다.
- Own: Go module에서 binding은 파일 `zz_generated_*.go`를 소유합니다(binding GN-3). Go module은 소스로 받아 오므로 그 파일은 추적하고, `make bindings`가 다시 씁니다. `packages/ts/wasm/generated`와 `packages/go/internal/ffi/generated`는 추적하지 않으며, wasm-bindgen이 앞의 것에 module과 그 glue를 씁니다.
  Enforced by: `make layout-check`
- Own: 변수 `GO`, `GOFMT`, `WASM_BINDGEN`, `MATURIN`, `PHP`, `PHP_CONFIG`, `PHPUNIT`는 바인딩 시험의 도구를 가리키며, 기본값은 `mise.toml`과 `.php-version`이 고정하는 checkout의 도구입니다. `make test-go`는 `packages/go/go.mod`의 go directive와 다른 release의 Go를 실패시키고 `GOTOOLCHAIN=local`로 실행해 toolchain을 받아 오지 않습니다. `make test-node`와 `make test-wasm`이 함께 쓰는 `make node-package`는 `packages/ts/wasm/Cargo.toml`의 `wasm-bindgen` crate와 다른 release의 wasm-bindgen CLI를 실패시킵니다. CLI는 자기 release의 module만 읽기 때문입니다(binding GN-18).
  Enforced by: none, `make test-go`와 `make node-package`의 recipe가 실행할 때 release를 비교합니다.

<a id="tools"></a>
## 도구

- Own: recipe는 이 repository의 것입니다. `Makefile`은 release asset에 고정한 npm 패키지 `@polyspec/kit`의 utility를 명시적 인자로 실행하고, 각 도구는 자기 file(`.npmrc`, `mise.toml`, `ruff.toml`, `.oxlintrc.json`, `knip.json`)에서 설정을 읽습니다. kit은 여기에 recipe를 include하지 않고 file을 쓰지 않습니다.
  Enforced by: none, recipe가 어떤 utility를 실행할지는 이 repository가 정합니다.
- Own: 개발 중에는 변경을 담당하는 Red/Green unit test를 실행합니다. 전체 suite는 `main`의 모든 push에서 CI가 실행합니다.
  Enforced by: none, 로컬 실행은 도구가 관찰하지 않습니다.
