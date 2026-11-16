<!-- doc-id: rebuild-release-manifests -->
<!-- source-sha256: 8c0cb05f10e1857d7745205a02783af0fcf68f8da78d2fadaca145ae87b95b95 -->
# 재구현 기록: release manifest

[English](release-manifests.md)

판정: **checkout의 도구가 JSON과 Python manifest를 쓴다. Cargo 값과 changelog section을 쓰는 도구는 없다.** 그래서
`scripts/release-manifests.mts`가 그것들을 직접 쓴다(T2.44). 2026-11-16에 checkout의 `git archive` 사본에서, checkout이
pin한 도구만으로, 새 도구 없이 쟀다.

## 다루는 것

- `scripts/release-manifests.mts`

## 요구

`make release-version VERSION=X.Y.Z`와 `make binding-pin BINDING_TAG=vX.Y.Z`(T2.40)는 manifest마다 값 하나만 쓰고 그
밖에는 바꾸지 않는다:

| 항목 | 요구 |
|---|---|
| R1 | `package.json`과 `packages/ts/package.json`의 version |
| R2 | `packages/python/pyproject.toml`의 version |
| R3 | `config/release.json`이 version이나 git-tag 종류로 이름 대는 `Cargo.toml` 여섯의 `[package] version` |
| R4 | `Cargo.toml` 여섯에 있는, binding git source의 `polyspec-binding-core` 의존 일곱 줄의 tag |
| R5 | `package.json` devDependencies의 `@polyspec/binding` release asset |
| R6 | `CHANGELOG.md`와 `CHANGELOG.ko.md`의 `## X.Y.Z` section. `## Unreleased`의 항목을 받는다 |

## 시험한 도구

| 도구 | 상태 | 항목 | 결과 |
|---|---|---|---|
| `npm pkg set version=9.9.9` | `var/tools`의 npm 12.2.0 | R1 | exit 0. diff는 각 파일의 `"version"` 한 줄이고, 2칸 배치가 그대로다 |
| `npm pkg set devDependencies.@polyspec/binding=<asset>` | npm 12.2.0 | R5 | exit 0. diff는 `@polyspec/binding` 한 줄이다 |
| `packages/python`에서 `uv version 9.9.9 --frozen` | `mise.toml`의 uv 0.12.24 | R2 | `polyspec-php-serialization 0.0.13 => 9.9.9`. diff는 `version` 한 줄이다. `--no-sync`를 함께 주면 거부한다: `the argument '--no-sync' cannot be used with '--frozen'` |
| `cargo set-version` | `rust-toolchain.toml`의 cargo 1.99.0 | R3 | `error: no such command: 'set-version'`. cargo-edit의 명령이고, checkout은 그것을 pin하지 않는다 |
| `cargo add polyspec-binding-core --git <binding> --tag v0.0.12 -p polyspec-php-serialization` | cargo 1.99.0, online | R4 | 줄을 `{ git = "...", tag = "v0.0.12", version = "0.0.12" }`로 바꿔 필드를 더한 뒤 실패했다: `Dependency 'polyspec-binding-core' has different source paths depending on the build target. Each dependency must have a single canonical source path irrespective of build target.` `--dev`와 `-p polyspec-php-serialization-php-ext`도 같다 |
| 같은 명령, cache에 없는 tag로 `--offline` | cargo 1.99.0 | R4 | `failed to find tag 'v0.0.15'`. tag를 가져오기 전에는 돌 수 없다 |
| kit의 `scripts/kit/changelog.mts` | kit 0.0.116 | R6 | section을 읽고 형식을 판단한다. 쓰지는 않는다 |
| kit | kit 0.0.116 | R1–R6 | release 값을 쓰는 것이 없다. `release.mts`는 `config/release.json`의 version을 읽고 확인하며, release asset과 notes만 쓴다 |

## 나머지를 여기서 쓰는 이유

R1, R2, R5는 make가 `NPM`과 `UV`로 이름 대는 npm과 uv가 `npm pkg set`과 `uv version --frozen`으로 쓴다. Cargo에는
`[package] version`을 쓰는 pin된 명령이 없다(R3). `cargo add`는 manifest를 하나씩 쓰고 그때마다 workspace를 resolve한다.
그래서 처음 바뀐 줄이, 아직 옛 tag인 나머지 여섯과 다른 `polyspec-binding-core` source를 가리키게 되고, 나머지가 바뀌기
전에 resolve가 실패한다. 줄에 `version` 필드도 더한다(R4). polyspec의 changelog는 항목마다 손으로 쓰므로 그 section을
쓰는 도구가 없다(R6). 스크립트는 R3과 R4의 줄을 하나씩 바꾸고 R6의 항목을 옮긴 뒤, 모든 값을 데이터로 다시 읽는다: cargo
metadata, tomllib, JSON.parse.

## 재시도 조건

checkout이 `[package] version`을 쓰는 cargo 명령(cargo-edit, 또는 cargo 자체의 `cargo set-version`)이나, workspace의 모든
manifest에서 git 의존의 tag를 한 번에 쓰는 명령을 pin하면 다시 본다.
