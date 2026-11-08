<!-- doc-id: development -->
<!-- source-sha256: db2047addb6ff3c971440e4b55575df9457023d41d48fdcb186061ce0c303d84 -->
# 개발 절차

[English](AGENTS.md)

모든 polyspec repository의 작업 원칙은 kit의 [PRINCIPLES.ko.md](https://github.com/polyspec/kit/blob/main/PRINCIPLES.ko.md)에 있습니다. 이 문서는 이 repository의 규칙만 적습니다.

<a id="reference"></a>
## 기준

- Own: 형식의 기준은 PHP입니다. PHP와 다르면 패키지의 결함입니다. 일부러 거부하는 입력은 [명세](docs/spec/php-serialize.ko.md#refused)와 contract의 `stricter` 항목에 적습니다.
  Enforced by: `make contracts-check`, `make fuzz`
- Own: 기록은 형식의 출처로 PHP만 적고 이 repository만 설명합니다.
  Enforced by: none, 기록의 표현은 판단입니다.
- Own: contract는 실제 PHP가 쓴 데이터만 담고 언어별 형태를 담지 않습니다. 새 runtime은 `packages/` 아래의 새 패키지입니다.
  Enforced by: none, 안내 규칙: kit은 구현들이 서로 어떻게 관계되는지 검사하지 않으며, 각 저장소가 자기 테스트를 실행한다(K1129)

<a id="tools"></a>
## 도구

- Own: recipe는 이 repository의 것입니다. `Makefile`은 release asset에 고정한 npm 패키지 `@polyspec/kit`의 utility를 명시적 인자로 실행하고, 각 도구는 자기 file(`.npmrc`, `mise.toml`, `ruff.toml`, `.oxlintrc.json`, `knip.json`)에서 설정을 읽습니다. kit은 여기에 recipe를 include하지 않고 file을 쓰지 않습니다.
  Enforced by: none, recipe가 어떤 utility를 실행할지는 이 repository가 정합니다.
- Own: 개발 중에는 변경을 담당하는 Red/Green unit test만 실행합니다. 전체 suite는 `main`의 모든 push에서 CI가 실행합니다.
  Enforced by: none, 로컬 실행은 도구가 관찰하지 않습니다.
