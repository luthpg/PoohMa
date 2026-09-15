# ADR-007: Worker Offloading for Encryption and CSV Processing

## Status

Accepted

## Context

PoohMa の CSV インポート機能では、最大500行のサービスレコードおよび付随するクレデンシャル（最大10件/行）を一括で処理する。
インポート処理には、以下の計算・通信処理が含まれる：

1. CSV テキストのパース・バリデーション（PapaParse）
2. 既存レコード一覧との差分判定（`stableId` 突合）
3. 新規レコード（CREATE）に対する OGP メタデータ・ふりがなの取得（Convex Actions 呼び出し）
4. パスワードヒント（PasswordHint）の E2EE 暗号化（Web Crypto API による AES-GCM 暗号化）

大量データの一括暗号化およびデータ加工処理において、メインスレッド（UI スレッド）のブロッキング（フレーム落ち・フリーズ・入力遅延）を防ぐため、Web Worker または Service Worker によるバックグラウンド処理へのオフロードを導入すべきかを評価・判断する必要があった。

## Decision

現時点では **Web Worker および Service Worker を導入せず**、既存の **`processInChunks`（10件単位のマクロタスク分割・UIスレッド解放）と Web Crypto API の非同期実行モデルの組み合わせを継続採用** する。

## Alternatives

- **Service Worker によるオフロード**:
  - **不採用の理由**: Service Worker は主に PWA（Progressive Web Apps）、オフラインキャッシュ、プッシュ通知、ネットワークリクエストのプロキシを目的として設計された機構であり、単一タブのユーザー主導による短時間の計算・暗号化処理を実行する用途には不適。また、ライフサイクル管理が複雑であり、キャッシュ更新のデバッグ負担が大きい。
- **Web Worker（専用 Worker）によるオフロード**:
  - **メリット**: JavaScript の重い計算処理をメインスレッドから完全に分離された別スレッドで実行できるため、メインスレッドの CPU 使用率を最小限に抑えられる。
  - **不採用の理由**:
    1. **暗号鍵（CryptoKey）転送とポストメッセージ通信の複雑化**:
       - E2EE のマスターキー（`CryptoKey`）を Worker に渡すには Structured Clone アルゴリズムに対応したブラウザ環境が必要となる。
       - メインスレッドと Worker 間のステートマシン・エラーハンドリング・キャンセル処理のメッセージプロトコルが複雑化し、コードベースの認知的負荷が増大する。
    2. **Web Crypto API の本質的な非同期性**:
       - `crypto.subtle.encrypt` などの Web Crypto API は、ブラウザ内部（C++層）のスレッドプールで並列かつ非同期に実行される。JavaScript レベルでは単なるプロミスのハンドリングであり、メインスレッドの CPU を長時間占有しない。
    3. **差分インポート（UPDATE）の負荷特性**:
       - 差分更新（UPDATE）では、PasswordHint が記載されているクレデンシャルのみが暗号化対象となる。
       - 空欄のヒントはスキップされ、重い OGP 取得やふりがな生成も CREATE 行に限定されるため、従来の全件新規登録と比較して実効負荷は大幅に低い。
    4. **ビルド・バンドル設定および CSP の保守オーバーヘッド**:
       - TanStack Start / Vite 環境において Worker スクリプトの別バンドル化・インライン化の設定が必要となり、Content Security Policy（CSP）において `worker-src` ディレクティブの精査・追加が必要になる。

## Consequences

- **アーキテクチャの単純性と保守性の維持**:
  - Worker 通信や別ファイルのバンドル設定を排除し、フック（`useImportCsvDiff.ts`）内で直線的かつ堅牢に処理パイプラインを完結できる。
- **UI 応答性とプログレス表示の両立**:
  - 10件単位で `setTimeout(0)` によるマクロタスク yield を行う `processInChunks` により、大量データの処理中もブラウザの描画ループ（60fps）やユーザーのキャンセル操作・プログレスバーのアニメーションが阻害されない。
- **仮想スクロール（@tanstack/react-virtual）との相乗効果**:
  - 解析後のプレビュー表示においても DOM ノード数を最小限に抑える仮想化を採用しているため、メモリ消費量とレンダリング負荷が適切に制御される。
- **将来の再評価**:
  - 将来的にインポート上限を大幅に引き上げる場合（例: 5,000行以上）や、クライアント側での画像圧縮・大規模データ変換が必要となった場合には、本決定を再評価して Dedicated Web Worker の導入を再検討する。

## 関連ドキュメント

- [ADR-001: E2EE Architecture](./001-e2ee.md)
- [ADR-002: Key Management](./002-key-management.md)
- [詳細設計書（CSVエクスポート・インポート仕様）](../code-design.md)
