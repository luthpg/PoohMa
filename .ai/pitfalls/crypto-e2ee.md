# Pitfalls: 暗号化 (E2EE) & WebAuthn

E2EE 暗号化および WebAuthn 実装における落とし穴と回避法です。

---

### WebAuthn PRF 拡張の役割の誤解

- **問題**: PRF 拡張が生体認証によるマスターキー直接導出や認証バイパスを行っていると誤認しやすい。
- **実際**: PRF 拡張は「家族パスコードをローカル IndexedDB に暗号化保存し、次回以降のパスコード入力を生体認証で代行する」ためだけに利用されている。復号されたパスコードは通常の `unlock(passcode)`（PBKDF2 鍵導出）に渡される。

---

### CryptoKey の `extractable` と `keyUsages` の不整合

- **問題**: `generateDEK()` や `unwrapMasterKey()` で `extractable: false` に設定すると、後の再ラップ（`wrapKey`）や家族移行処理でエクスポートできずランタイムエラーになる。また DEK の usages に不要な `wrapKey` を含めると暗号化仕様の整合性を欠く。
- **回避法**: `apps/web/src/lib/crypto.ts` の既存関数（`generateDEK`, `wrapMasterKey`, `unwrapDEK`）のパラメータ設計を厳守し、独自に `crypto.subtle.generateKey` を呼ばない。

---

### `KDF_VERSIONS` の変更による既存データ復号不能

- **問題**: パスコード反復回数を引き上げる際に `KDF_VERSIONS[1]` の値を書き換えると、既存ファミリーのデータが復号できなくなる。
- **回避法**: `KDF_VERSIONS` は新しいバージョン番号（2, 3...）を追記し、既存エントリは絶対に変更しない。
