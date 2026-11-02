<!-- doc-id: plan-execution -->
<!-- source-sha256: c3f5864fd30f595ded48f47fd90f4eb74a6654bbbe7d74be4901308337b3a4cd -->
# 실행 계획

[English](plan.md)

<a id="wave-1"></a>
## Wave 1 — 첫 release

다른 언어의 서버가 PHP의 데이터를 읽으려면 형식이 모든 byte에서 PHP와 같게 동작해야 합니다. T1.1은 PHP 소스에서 Node.js와 Python으로 형식을 포팅하고, 실제 PHP가 쓰는 contract와 PHP를 기준으로 하는 fuzz로 증명하며, kit으로 repository를 구성합니다. T1.2는 이를 release합니다. 완료 기준은 `main`의 CI 성공과 그 commit의 release asset입니다.
