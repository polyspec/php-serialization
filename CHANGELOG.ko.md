<!-- doc-id: changelog -->
<!-- source-sha256: abe769edc0866435665756e3d24af42c2854df72a09dcd98c4a2dbba56b38476 -->
# 변경 기록

[English](CHANGELOG.md)

<a id="unreleased"></a>
## Unreleased

- 명세는 형식의 값을 정하고(RQ-008), U+0000으로 시작하는 속성 이름을 읽을 때와 값을 만들 때 거부하며(RQ-009), 모든 실패의 kind와 offset을 정하고(RQ-010), 규칙을 Rust crate `polyspec-php-serialize`에 두고 Node.js와 Python 패키지의 차이를 판정한다(RQ-011) (T2.1).
- contract는 모든 거부의 kind를 `raises`에 적고, U+0000으로 시작하는 속성 이름을 `stricter`와 새 group `refused_values`에 담으며, Node.js와 Python 패키지는 그런 이름을 읽을 때와 쓸 때 거부한다(RQ-009) (T2.1).
- `packages/rust`의 Rust crate `polyspec-php-serialize`는 PHP 값의 자기 타입 위에서 RQ-010의 kind로 형식을 읽고 쓰며 contract를 통과한다(`make test-rust`, `make lint-rust`). `make fuzz`는 입력과 무작위 PHP 값의 bytes를 crate에도 주고, CI는 Rust job을 실행한다(T2.1).
- `contracts/interface.json`은 바인딩의 인터페이스 계약 초안이다: 함수, offset을 가진 오류 class, `php_value`의 값 표, Node.js와 Python 패키지에서 바뀌는 점. 형식이 아직 담지 못하는 곳은 `todo`로 둔다(T2.1).
- 인터페이스 계약을 `packages/rust/interface.json`으로 옮기고 crate의 `include`에 넣는다. `php_value`를 받거나 내는 라이브러리가 Cargo가 해석한 패키지에서 값 표를 읽게 하기 위해서다. 계약은 bindgen 스키마를 따른다: category 오류 클래스는 모든 언어에서 `PhpSerialize<Category>Error`(`PhpSerializeValueError` 등)이고, `php_value`는 alias이며 그 값 표는 PHP 배열을 int와 bytes key의 map으로 만들고 `stdClass`와 참조는 PHP 객체와 참조 그대로 두며 각 언어의 내장 타입은 bindgen이 직접 읽는다. 형식이나 코어가 아직 담지 못하는 곳은 `todo`로 남는다(T2.1).
- crate의 `DEPTH_LIMIT`는 인터페이스 계약의 `uint` 타입인 `u64`이고, crate는 Node.js class `PhpFloat`의 생성자, `value`, `valueOf`가 부르는 `PhpFloat`를 가진다(RQ-008) (T2.1).
- `php_value`의 값 표를 채운다: alias만 `out`·`in` 행을 가지고 `PhpFloat`, `StdClass`, `Reference`를 모으며, `StdClass`의 속성은 text와 bytes key의 keyed map이고, JavaScript number는 정수가 아니면 float, 안전 정수면 int, 그 밖에는 float로 다시 읽힌다. 언어에서 `php_value`를 받는 코어가 생길 때까지 `StdClass`와 `Reference` 생성자의 코어만 `todo`로 남는다(T2.1).
- crate는 언어의 값을 `from_host`로 읽는다(RQ-012): 바인딩은 값을 한 단계씩 설명하고 handle의 자식에 답하며(`HostValues`), JavaScript number는 안전 정수이고 `-0`이 아니면 int이고, 객체와 참조는 정체성을 지키며, PHP에 없는 값은 새 kind `unsupported_value`, `invalid_text`나 이제 언어 값의 정수도 가리키는 `int_range`로 거부한다. `StdClass`와 `Reference` 생성자는 같은 규칙으로 받는 것을 판정하는 `check_std_class`와 `check_reference`를 부르므로 인터페이스 계약에 `todo`가 남지 않는다(T2.1).
- Node.js와 Python 패키지를 `legacy/packages/js`와 `legacy/packages/python`으로 옮기고 생성된 바인딩이 대체할 때까지 배포 대상에서 뺀다([이행](docs/spec/php-serialize.ko.md#transition)). 바인딩은 `bindgen scaffold`가 쓰는 얇은 패키지 `packages/python`, `packages/ts`, `packages/php-ext`이며, 루트 Cargo workspace가 crate와 함께 하나의 `Cargo.lock`으로 담고, `make bindings`와 `make bindings-check`는 고정한 commit의 bindgen을 실행한다(T2.1).

## 0.0.6

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
