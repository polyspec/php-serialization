<!-- doc-id: plan-rust-core -->
<!-- source-sha256: 072a23b21e4db4408f78e8c096c5fc62e9b829417ebc08b9aee9464e6717db78 -->
# Rust 코어

[English](plan.md)

형식의 규칙은 한 벌인데 구현은 언어마다 하나씩 두 벌이라, 규칙 하나를 두 번 쓰고 시험하고 고치며 세 번째 런타임은 세 번째 복사본을 더합니다. T2.1은 규칙을 `packages/rust`의 Rust crate `polyspec-php-serialization`로 한 번 쓰며, PHP 값의 자기 타입 위에(RQ-008) 모든 실패의 오류 kind와 함께(RQ-010) 씁니다. 실제 PHP가 계속 오라클입니다: crate는 contract의 모든 case와 PHP에 대한 fuzz를 통과합니다. 런타임마다의 바인딩은 `packages/rust/interface.json`에서 생성하며 T2.1에 들지 않습니다. Node.js와 Python 패키지는 바인딩이 대체할 때까지 남습니다(RQ-011).
