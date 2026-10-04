# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

技術書を読みながら、気になった箇所を選択して AI に質問できる PDF / EPUB リーダー。利用者は 1 人。
React 19 (SPA) + Hono (Worker) + D1 + R2 を単一の Cloudflare Workers プロジェクトにまとめ、
`@cloudflare/vite-plugin` で SPA と Worker を同一の `vp dev` で動かす。

**公開先は `https://<worker 名>.<アカウント>.workers.dev`**（`wrangler.jsonc` の `name` と
Cloudflare アカウントのサブドメインで決まる）で、API はログインの内側にある
（下記「ログインとセッション」）。ローカルだけで動かしていた頃の前提（ログイン不要）は
もう成り立たない。

## コマンド

`vp`（Vite+）に統一。生の `vite` / `vitest` は直接叩かない。

```bash
vp dev                    # SPA + Worker を同時起動 (http://localhost:5173)
pnpm run db:migrate:local # D1 マイグレーション適用（初回 / migrations 追加時のみ、自動適用はしない）

pnpm test                 # フロント単体 (jsdom)
pnpm run test:worker      # Worker 単体 (@cloudflare/vitest-pool-workers)
pnpm run test:e2e         # E2E (Playwright)。サーバーは自動起動するので vp dev は不要

vp check                  # フォーマット + lint + 型チェック（--fix で自動修正）
vp exec wrangler types    # wrangler.jsonc の bindings/main 変更後に Env 型を再生成
```

単体テストを1ファイルだけ走らせる: `vp exec vitest run src/front/lib/sseParser.test.ts`
1 つの project だけ走らせる: `pnpm run test:e2e --project=mobile`（`desktop` / `tablet` / `mobile`）
E2E を1件だけ走らせる: `pnpm run test:e2e -g "テスト名の一部"`（`--` を挟むと pnpm が
それをそのまま playwright へ渡し、`-g` が効かないまま全件走る）

`git push` 時に lefthook の `pre-push` が `vp check` + `vp build` を実行し、失敗すると push はブロックされる。

### worktree を作ったら最初に `.dev.vars` を用意する

`.dev.vars` は gitignore 済み（`.gitignore:4`）で **worktree には複製されない**。無いまま
`vp dev`（`pnpm run test:e2e` の自動起動を含む）を動かすと、`@cloudflare/vite-plugin` が
commit 済みの `worker-configuration.d.ts` を再生成し、`LLM_*` の宣言が消えた差分が
毎回出る。worktree を切ったら実装を始める前に用意する:

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars.example` が実際に読む鍵をそのまま並べてあるので、コピーすればそのまま動く
（`LLM_API_KEY` はダミー、ログインは `demo` / `demo`）。

型の差分は値ではなく鍵の**存在と並び順**で決まるので、ダミー値でも空値でも消える——
`LLM_BASE_URL` / `LLM_MODEL` / `LLM_WEB_SEARCH_SUPPORTED` を値の空いた行で並べてあるのは
そのためで、**使わないときも行を消さず、並べ替えもしないこと**（どちらも型が変わる。
commit 済みの `worker-configuration.d.ts` は `.dev.vars.example` の並びで生成してある）。
現在の E2E は LLM へ
問い合わせないので、実キーが要るのは手で回答の生成を確かめるときだけ。そのときはメインクローンの
`.dev.vars` からコピーする。**チャット送信を E2E に足すなら実キーが要る**——ダミー値では認証が
通らず、トークンが 1 つも届かないまま 60 秒のタイムアウトまで粘って落ちる。

**`AUTH_*` が無いと API は全部 401 になる**ので、`.dev.vars` を用意しないと E2E も画面も
何も動かない（上記「ログインとセッション」の「秘密が無ければ閉じる」）。

### `useEffect` の扱い

`vite.config.ts` の `no-restricted-imports` が `useEffect` の import を禁止している。
このアプリは canvas 描画・DOM 購読・pdf.js の命令的 API が本質なので使う場面が多いが、
ルールは**残したまま**、使う側が import 行に
`// oxlint-disable-next-line no-restricted-imports -- <理由>` を付けて理由を明記する運用にしている。
新しく足すときも同じように理由を書くこと。

現在 18 ファイルに理由コメントがあり、内訳は次の 5 つしかない。新しく足す `useEffect` も
このどれかに当てはまるはずで、当てはまらないなら書き方を疑うこと:

| 用途                                                    | ファイル                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pdf.js という命令的ライブラリの呼び出しと後始末         | `useEpubDocument.ts`（EPUB のバイナリ取得と展開、画像の blob URL の解放）、`PdfPage.tsx`（`RenderTask` / `TextLayer`）、`usePdfDocument.ts`（バイナリ取得とドキュメント構築）、`usePdfOutline.ts`（`pdfOutline.ts` の `readOutlineEntries` の呼び出しと後始末）、`usePageBaseSize.ts`（`getViewport({scale: 1})` でページの素の寸法）                                                                                                                                     |
| `document` / `window` / `ResizeObserver` の購読         | `useKeyboardShortcuts.ts`、`SettingsMenu.tsx`・`ShelfSettingsMenu.tsx`・`ChatScopeMenu.tsx`・`EpubTypographyMenu.tsx`（Escape と外側クリックで閉じる）、`SelectionPopover.tsx`、`PdfViewer.tsx`、`EpubViewer.tsx`（ペインと章の `ResizeObserver`、章の画像の `load`、描かれた章からのハイライト・引用箇所の計測）、`useSettledSelection.ts`（`document` の `selectionchange` と `window` の pointer 系）、`HtmlDiagram.tsx`（`document` の `keydown` で Escape を閉じる） |
| 非 passive なジェスチャの購読（ブラウザの既定を止める） | `PdfViewer.tsx`（ctrlKey wheel のピンチ、touch と Safari の gesture イベント）                                                                                                                                                                                                                                                                                                                                                                                            |
| DOM への命令的な書き込み（スクロール位置）              | `ChatMessageList.tsx`（最下部へ追随）、`PdfViewer.tsx`（ページ遷移時のリセット）、`EpubViewer.tsx`（無害化した章の差し込み。画面をめくるのは DOM への書き込みではなく `translateX` の描画。スクロールで読むときの `scrollTop` は `useLayoutEffect` とイベントハンドラが書く）                                                                                                                                                                                             |
| URL とサーバという React の外の状態への同期             | `useReadingLocation.ts`、`useReadingStateSync.ts`（読書位置の保存と離脱時の書き残し）                                                                                                                                                                                                                                                                                                                                                                                     |

**画面幅の購読には `useEffect` を使わない**。`useIsNarrow`（`src/front/hooks/useIsNarrow.ts`）が
`useSyncExternalStore` で `matchMedia` を購読する。購読するのは幅そのものではなく
メディアクエリの真偽なので、再レンダーはレイアウトが切り替わるときだけ起きる。

**データ取得は理由にならない**。一覧・本・ハイライト・引用箇所のページ解決は SWR へ
移してある（下記「状態管理とルーティング」）。

**SWR が持っているものを atom へ写すのも理由にならない**。写した瞬間に同じデータが
2 箇所に載り、更新のたびに 1 レンダー遅れる。読み手が少ないなら props で配る
（`AppPage` → `PdfViewer` / `ChatArea` の `book` がその形）。

これと紛らわしいものが 3 つある。どれも `useReadingLocation.ts` で、SWR が解いた値を
atom に一度だけ書く——`useSWRImmutable` が解いた「引用箇所のページ番号」を
`currentPageAtom` に、`useBook` が返した本の中から URL の `?selection=` が名指した
ハイライトを `activeSelectionAtom` に（`openChat` 経由。下記「リーダーの URL は
`useReadingLocation` が単独で書く」）、同じく `useBook` が返した本の `readingState` を
`currentPageAtom` / `activeSelectionAtom` / `outlineOpenAtom` / `chatPanelOpenAtom` に
（下記「読んでいた場所は本と一緒に運ぶ」）。これは写しではない: どの atom も「読者が今どこを
見ているか」というクライアント状態で、キーボード・ページ送りボタン・目次・URL・一覧の
クリックも書き込む。取得結果はその状態を**一度だけ動かすきっかけ**であって、サーバのデータを
atom に常駐させているわけではない。
**サーバの値がそのまま atom に載り続けるなら写し（禁止）、一度きりの入力なら可**。

## アーキテクチャ

### ログインとセッション

インターネットに出しているので、`/api/*` は**既定で閉じている**。素通しするのは
`/api/health` と `/api/auth/login` と `/api/auth/logout` の 3 つだけで、
`src/server/routes/auth.ts` の `requireSession` が**完全一致で**列挙する。前方一致にしないのは、
あとから足したパスが偶然素通りしないようにするため。middleware は
`src/server/index.ts` で全ルートより先に登録してあるので、新しいルートは黙って守られる。

**利用者が 1 人なので、D1 に所有者の列は無い**。「ログインした人＝全データの持ち主」で
正しい。アカウントを増やすときに初めて `schema.ts` とマイグレーションと全クエリに波及する。

| 何を                                        | どこに                                                 |
| ------------------------------------------- | ------------------------------------------------------ |
| セッションの署名・検証・Cookie の組み立て   | `src/server/auth/session.ts`（純関数。単体テストあり） |
| ログイン・ログアウト・在籍確認と middleware | `src/server/routes/auth.ts`                            |
| front と server が交わす形                  | `src/shared/schemas/auth.ts`                           |
| 画面側のゲートとパスワード入力              | `src/front/components/RequireSession.tsx`              |
| 在籍を確かめるフック                        | `src/front/hooks/useSession.ts`                        |

**セッションは HMAC で署名した Cookie 1 本**（`chatbook_session`、30 日）。中身は失効時刻
だけで、誰であるかを持たない。**署名を先に検証してから失効を読む**ので、失効時刻を書き換えた
トークンは長いセッションではなく偽物として落ちる。D1 にテーブルは無い。

**Cookie には `Secure` を付ける**。公開する以上、平文で運ばれるセッションは平文で運ばれる
パスワードと同じであるため。代償として**LAN の `http://192.168.x.x:5173` ではログインできない**
（ブラウザが Cookie を保存しない）。スマホからは公開 URL を使う。`localhost` は安全な
オリジンとして扱われるので、ローカル開発と E2E は影響を受けない。

**秘密が設定されていなければ全部閉じる**。`AUTH_USERNAME` / `AUTH_PASSWORD` /
`AUTH_SESSION_SECRET` のどれかが空だと、ログインは 500 (`CONFIG_ERROR`)、保護対象は 401 の
まま。設定を忘れたまま公開してしまう事故を防ぐためで、**初回のデプロイは意図的に閉じた状態で
出す**（下記「デプロイ」）。

画面側は `/login` へ飛ばさず、`RequireSession` がその場でパスワードを聞く。読者の居場所は
アドレスに載っている（`?page=` / `?selection=`）ので、別ルートへ送ると
戻り先を持ち回る仕掛けが要る。**401 とそれ以外は区別する**——401 はサーバーが「まだログインして
いない」と言っているのでパスワードを聞き、それ以外（回線断・500）は「確かめられなかった」
と出す。後者でパスワードを聞くと、読者のせいでないことを読者のせいにしてしまう。

**端末を失くしたときの取り消し手段は `AUTH_SESSION_SECRET` の入れ替え 1 つだけ**。
セッションは stateless なので個別には失効させられず、入れ替えると自分の端末も含めて
全部ログアウトになる。

### PWA としてのインストール

`public/manifest.webmanifest` と各種アイコン（`icon-192.png` / `icon-512.png` /
`icon-maskable-512.png` / `apple-touch-icon.png`）、`index.html` の `<link rel="manifest">` と
`theme-color` でインストールできる。アイコンの元は `favicon.svg` と `icon-maskable.svg`
（余白を取った全面塗り）で、PNG は `rsvg-convert -w <px> -h <px>` で作り直してコミットする。

**Service Worker は意図的に置かない**。API はログインの内側にあり、本の中身をオフライン用に
キャッシュすると共有キャッシュ・失効の扱いが増えるだけで、利用者の得が無い。Chrome / Edge は
Service Worker 無しでもインストールを出し、iOS は「ホーム画面に追加」で足りる。
マニフェストは静的アセットなので `requireSession` の外（`/api/*` ではない）から取れる。

### デプロイ

```bash
pnpm run deploy   # vp build してから wrangler deploy
```

`wrangler.jsonc` の `database_id` には作者の環境の D1（`chatbook-db`。R2 は
`chatbook-pdfs`）の実 ID が入っている。**fork したら README の「デプロイ」の手順で
自分の値に置き換える**（D1 の ID はアカウントの API トークンが無ければ使えないので
秘密ではないが、そのままでは他人のデータベースを指す）。
**マイグレーションを足したらリモートにも当てる。順番は
デプロイより先**——列を足したマイグレーションが当たっていない D1 に新しいコードを載せると、
本を開く経路ごと 500 になる（理由は下記「読んでいた場所は本と一緒に運ぶ」）:

```bash
vp build   # dist/chatbook/wrangler.json を作り直す。これを飛ばすと古い設定が読まれる
vp exec wrangler d1 migrations apply chatbook-db --remote
```

**OCR（テキストの無い PDF）はマイグレーションを要さない**——行は R2 の `ocr/<sha256>.json` に
置き、有無も R2 の head で見る（下記「テキストの無い PDF（OCR）」）。そのぶんデプロイには
`public/tesseract/`（約 17MB の静的アセット）が乗るので、`pnpm install` を済ませた（`postinstall`
が複製した）チェックアウトから `pnpm run deploy` すること。

秘密は 4 つ（Dropbox を使うならさらに 3 つ。下記「Dropbox 連携」）、`wrangler secret put <名前>` で入れる（`.dev.vars` はローカル専用でデプロイには
乗らない）: `LLM_API_KEY` / `AUTH_USERNAME` / `AUTH_PASSWORD` / `AUTH_SESSION_SECRET`。
接続先とモデル（`LLM_BASE_URL` / `LLM_MODEL` / `LLM_WEB_SEARCH_SUPPORTED`）は秘密ではないので、
**DeepSeek 以外に向けるときだけ** `wrangler.jsonc` の `vars` に書く（省略すれば DeepSeek。
下記「LLM の呼び分け」）。**キーを `vars` に書かないこと**——あのファイルは git に入る。
`DEEPSEEK_API_KEY` から移ってきたデプロイは、同じ鍵を `LLM_API_KEY` として入れ直す必要がある。
**Worker がまだ無い状態の `secret put` は対話プロンプトを出す**ので、順番は
「デプロイ → secret put」。`secret put` は既存 Worker に新しいバージョンを自動で配るので、
入れ終わったあとの再デプロイは要らない。

鍵がかかっていることの確認は、公開 URL に対する 401 が唯一の証拠:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<worker 名>.<アカウント>.workers.dev/api/pdfs  # 401
```

### PDF の処理はブラウザ側で行う（重要）

pdf.js は workerd 上で動かない（native canvas を要求して落ちる）。そのため:

- **テキスト抽出・表紙生成・描画はすべてクライアント**（`src/front/lib/pdfLoader.ts`）
- **テキストの無い PDF（スキャンした本）の OCR もクライアント**（tesseract.js を Web Worker
  で。下記「テキストの無い PDF（OCR）」）
- クライアントが抽出済みの `fullText` / `pageCount` / 表紙 webp / 目次（トップレベル章の
  JSON、無い本は省略）/ OCR の行（OCR した本だけ。JSON のファイル）を **multipart** で
  `POST /api/pdf/open` に送り、Worker は保存だけを担う

サーバ側で PDF を解析しようとしないこと。

### ストレージの分担

| 置き場所          | 内容                                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 (`DB`)         | `pdfs` / `selections` / `chat_messages` のメタデータ（`pdfs` は本ごとの設定＝ページめくりの向きも持つ）、`settings`（画面から変える設定。今は `dropbox_folder` だけ） |
| R2 (`PDF_BUCKET`) | 本体 `pdfs/<sha256>.pdf` / `pdfs/<sha256>.epub`、表紙 `thumbnails/<sha256>.webp`、OCR の行 `ocr/<sha256>.json`                                                        |
| Dropbox（任意）   | PDF 本体。`pdfs.dropbox_id` が立っている本は Dropbox が正で、R2 はその写し                                                                                            |

**チャットは本に属し、ハイライトに（任意で）ぶら下がる。** `chat_messages` は `pdf_id` を
必ず持ち、`selection_id` を持つのはハイライトの会話だけ。本そのものへの質問（要約・章ごとの
質問）は **`selection_id IS NULL`** の行で、本ごとに 1 本。所有者の列が 2 つあるのは、
ハイライトを消したときにその会話だけが CASCADE で落ち、本の会話は残るようにするため
（本を消せば `pdf_id` の CASCADE で全部落ちる）。本の会話を引く索引は部分索引
`idx_chat_messages_pdf_time`（`WHERE selection_id IS NULL`）で、ハイライトの会話は 1 行も
載らない。ハイライトの検索（`findSelections`）は `selection_id` で EXISTS を取るので、
本の会話は構造的に混ざらない。

同一性は **内容の SHA-256** で判定する。同じ本を開き直すと同じ `pdfs.id` を返しつつ、
`fileName` / `fullText` / `pageCount` / `outline` / OCR の行を最新の抽出結果で**上書き**する
(`src/server/services/pdfService.ts` の `openPdf`)。ここを「既存レコードをそのまま返す」に
戻すと、古いメタデータが残り続ける不具合になる。**`outline` だけは、抽出が目次を持って
こなかったときに保存済みのものを残す**——同じバイト列なので、保存済みの目次は前回の抽出が
読めたもの（今回読めなかっただけ）か、しおりの無い PDF に AI が作ったもの（下記「目次の無い
PDF に AI で目次を作る」。費用を払って作った）のどちらかで、どちらも消す理由が無い。
読者が付けたもの——読書位置・題名（`title`）・ページめくりの向き（`page_direction`）——は
列挙から外してあるので、開き直しても残る。

#### Dropbox 連携

`DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` / `DROPBOX_REFRESH_TOKEN` の 3 つが揃い、かつ画面で
フォルダが選ばれているときだけ働く（`routes/dropbox.ts` の `dropboxFolderOf` が null を
返せば従来どおり R2 だけ）。取得手順は README の「Dropbox と連携する」。

| 何を                                          | どこが                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Dropbox API（トークン更新・一覧・取得・書込） | `src/server/services/dropboxService.ts`                                                          |
| フォルダの保存・未読み込みの一覧・バイト列    | `src/server/routes/dropbox.ts`（`/api/dropbox/settings` `files` `file`）                         |
| 取り込みとアップロード時の書き込み            | `src/server/routes/pdf.ts` の `POST /pdf/open`                                                   |
| R2 の写しが無いときの作り直し                 | `src/server/routes/pdf.ts` の `GET /pdf/:pdfId/file`                                             |
| front と server が交わす形                    | `src/shared/schemas/dropbox.ts`                                                                  |
| 本棚のカード・取得の進捗・フォルダの設定      | `ShelfPage.tsx` / `lib/dropboxDownload.ts` / `ShelfSettingsMenu.tsx` → `DropboxFolderDialog.tsx` |

- **本と Dropbox ファイルは `pdfs.dropbox_id`（Dropbox の `id:...`）で結ぶ**。パスではなく id
  なのは、Dropbox 側で改名・移動されても同じ本のままにするため。本の同一性は従来どおり
  SHA-256 で、`dropbox_id` は付け足しにすぎない
- **未読み込みの本はサーバでは読まない**（pdf.js は workerd で動かない）。ブラウザが
  `GET /api/dropbox/file?id=` で取得 → 抽出 → `POST /pdf/open` に **`file` ではなく
  `dropboxId`** を載せて送る。サーバは Dropbox から取り直して保存する——読者の回線で
  同じバイト列を上げ直させないため（上記の 22MB / 76 秒）。取得したバイト列は
  `rememberUploadedFile` に渡るので、ビューアも取り直さない
- **アップロードは Dropbox に書いてから R2 / D1 に保存する**。Dropbox が拒んだら 502
  （`DROPBOX_ERROR`）で何も保存しない。正が持っていない本を作らないため。書く前に
  Dropbox の `content_hash`（4MB ブロックごとの SHA-256 の SHA-256。`dropboxContentHash`）で
  フォルダを探し、同じ中身があればそれを本にして書かない。書くときは `mode: "add"` +
  `autorename` で上書きしない
- **`Dropbox-API-Arg` ヘッダは ASCII でなければならない**。日本語のファイル名は
  `headerSafeJson` が `\uXXXX` に逃がす（`dropbox.test.ts` の「Japanese name」が見張る）
- **`/dropbox/file` と取り込みは選んだフォルダの中のファイルしか扱わない**（`isInsideFolder`）。
  id を知っていればフォルダ外を読める口にしない
- **本の削除は Dropbox のファイルを消さない**。削除の確認文がそれを言い、消した本は
  未読み込みとして本棚に戻る
- **アクセストークンは isolate のメモリに期限まで持つ**（`accessTokens`）。401 が返ったら
  捨てて 1 回だけ取り直す
- **未読み込みの一覧は本棚と別の SWR（`/api/dropbox/files`）**。本棚の本が Dropbox を
  待たないため。一覧の失敗は本棚の失敗とは別の赤帯に出し、本棚そのものは描く

#### 本を開くまでの往復を増やさない

実測で分かった要点が 4 つある（2 冊で測った——209 ページ・2.3MB の実書籍と、
449 ページ・22MB の実書籍。**効くのはページ数ではなくバイト数**で、449 ページの抽出も
1 秒足らずで終わる）。本番では各段が往復コストを払うので、**直列に足したものがそのまま
待ち時間になる**。

- **アップロードした本のバイト列は手渡しする**（`src/front/lib/uploadedFileHandoff.ts`）。
  `useOpenPdfBook` が成功時に読者の選んだ `File` を 1 枠だけ置き、`usePdfDocument` が
  `/file` を叩く前にそれを見る。**上げたばかりの本を下ろし直さないため**——22MB の本を
  スマホから足すと、上りに 76 秒かけた直後に同じ 22MB を 49 秒かけて落としていた
  （本番の `wrangler tail` で実測。サーバ側の処理は 1.3 秒しかかかっていない）。
  **バイト列ではなく `File` を持つ**のは、pdf.js が渡されたバッファを detach するのと、
  `StrictMode` が読み込みを 2 回走らせるため（`File` は何度でも読み直せる）。
  **枠は 1 つで、手放すのはドキュメントを組み立て終えたとき**——途中で中断した読み込みに
  備えて残し、2 冊分を抱えない（スマホのメモリに数十 MB が居座る）。E2E の
  「adding a PDF from the shelf opens the reader…」が `/file` へのリクエストが 0 件で
  あることを見張る
- **`GET /pdf/:pdfId/file` はブラウザに持たせる**。本は自身のバイト列のハッシュで保存
  されるので、ある id が指す中身は変わらない。`Cache-Control: private, max-age=31536000,
immutable` と R2 の `httpEtag` を返し、`If-None-Match` は `onlyIf` で R2 に渡して 304 に
  する。**ヘッダをこちらで突き合わせてはいけない**——オブジェクトの取得自体は起きてしまう。
  `private` なのはセッションの内側にあるため（共有キャッシュに載ると次に尋ねた人へ本が渡る）
- **PDF バイナリの取得は本（`GET /pdf/:pdfId`）を待たない**。id は読者がたどったアドレスに
  載っているので、`usePdfDocument(pdfId, book)` は id だけで download を始め、`book` は表紙
  を作る要否にしか使わない。ここを `book` 待ちに戻すと、D1 を 2 回とハイライトと R2 の head
  を経る往復ぶん、download の開始が遅れる
- **応答に使わない列を select しない**。`/file` が要るのは `filePath` と `fileName` だけで、
  行ごと引くと `full_text`（実書籍で 213KB）まで D1 から読む。`readPdf` のハイライトと表紙の
  head は互いに独立なので `Promise.all` で並べる（OCR の行の有無を見る head もそこに並ぶ）
- **OCR の行（`GET /pdf/:pdfId/ocr`）は OCR した本でしか取りに行かない**。本の `hasOcr` が
  立っているときだけ `useOcrText` が SWR のキーを作るので、テキストのある本は 1 往復も
  増えない。`/file` と同じく `immutable` + ETag で、アップロード直後は `useOpenPdfBook` が
  キャッシュに先に置く（下記「テキストの無い PDF（OCR）」）

**効かなかったもの**: `pdf.worker`（gzip 486KB）の先読み。`modulepreload` は destination が
script なので worker が同じファイルをもう一度落とし、`rel="preload" as="worker"` は Chromium
が認識せず preload 自体が発生しない。**計測して両方とも取り下げた**ので、同じことを試す前に
ここを読むこと。

### 外部入力のバリデーション（zod）

front と server が交わす形は `src/shared/schemas/` に zod スキーマとして 1 箇所だけ置き、
型は `z.infer` で導出する（`error.ts` / `book.ts` / `bookSearch.ts` / `config.ts` / `selection.ts` /
`citation.ts` / `chat.ts` / `sse.ts` / `ocr.ts`）。front・server どちらにも同じ概念の型を書かないこと。

- **サーバの受け口**は `src/server/routes/validation.ts` の `validate(target, schema)`
  （`@hono/zod-validator` のラッパ）を通す。素の `zValidator` は zod のレポートをそのまま
  400 で返すため、クライアントが読む `error.message` を持たない。`validate` は
  `{ error: { code: "VALIDATION_ERROR", message: "Invalid request body: pageNumber" } }`
  の形に揃える。メッセージは zod の文言ではなく違反フィールドのパスなので、zod の更新で
  変わらない
- **クライアントの受け口**は `src/front/lib/fetcher.ts` の `fetcher(url, schema, init?, fetchFn?)`。
  `schema.safeParse` を通った値だけを返す。**レスポンスが返ったあとの失敗 2 系統**——サーバが
  拒否した（`error.code` を載せる。取れないときは `"UNKNOWN"`）と、レスポンスがスキーマに
  合わない（`"INVALID_RESPONSE"`）——を `ApiError`（`message` / `code` / `status` / `kind`）に
  揃えて throw する。`fetch` 自体が reject するネットワーク断・abort はここでは包まず、
  `TypeError` / `AbortError` がそのまま呼び出し側へ伝わる（包む版は下記 `resultFetcher`）
- **`src/server/services/chatService.ts` の `LlmMessage`** は LLM 送信用で `system` role を
  含み、保存される `ChatMessage`（`src/shared/schemas/chat.ts`）とは別物。shared に混ぜないこと

エラー形式は 2 系統あり、**ペイロード `{ code, message }` だけを共通化して transport の差は
残している**。ストリーム開始前は HTTP ステータス + `{ error: { code, message } }`、開始後は
`event: error` + 裸の `{ code, message }`。SSE ではイベント名が判別子なので `error` で包む
意味がない。ワイヤ上の `code` は前方互換のため `z.string()` で受け（読み手は知らない code を
渡す以外にできることがない）、サーバ側の構築だけ `shared/schemas/error.ts` の `ErrorCode`
union + `satisfies` で固定する。

### 失敗の運び方（neverthrow）

**失敗はユーザーに見える形にするか、握りつぶす理由をコメントに書くかのどちらかにする。**
`console.error` だけで済ませない（それは前者でも後者でもない）。

- **D1 / R2 に触る service は `ResultAsync`**（現状 `pdfService.ts` の 6 関数）。エラー型は
  `src/server/services/serviceError.ts` の
  `ServiceError = { type: "NOT_FOUND" } | { type: "STORAGE"; cause }` の 2 つだけで、
  `notFound()` / `storageFailure(cause)` が作る。route が `.match()` で封筒に落とす
  （`src/server/routes/pdf.ts` の `serviceFailureResponse` が 404、`storageFailureResponse`
  が 500 を組み立てる。**名前が似ているが、`storageFailure` は service が返す値、
  `storageFailureResponse` は route が返すレスポンス**）。「無い」は各エンドポイントの言葉で
  404、「ストアが応答しない」は一律 `INTERNAL_ERROR` の 500 で、`cause` はサーバのログにだけ
  出す。バインディングに触らない service（`chatService.ts` は純粋関数、`llmService.ts`
  は throw + callbacks でストリームを運ぶ）はこの対象外
- **想定外の throw と未定義パスは `src/server/index.ts` の `app.onError` / `notFound` が拾う**
  （それぞれ `INTERNAL_ERROR` / `ROUTE_NOT_FOUND`。どちらも `shared/schemas/error.ts` の
  `ERROR_CODES` に載っており、`index.ts` が `satisfies ErrorCode` で固定して唯一発行する）。
  Hono の既定は `text/plain` の "Internal Server Error" を返し、これは封筒ではないので
  `fetcher` からは `UNKNOWN` にしか見えない。`/api/*` だけが Worker に来る
  （`wrangler.jsonc` の `run_worker_first`）ので、`notFound` が SPA の直リンクを奪うことはない
- **フロントの読み取り（SWR）は throw ベースの `fetcher` のまま**。SWR の `error` state が
  その境界の Result そのもので、`Err` に変換して戻すのは往復の無駄
- **失敗を画面に出す mutation とイベントハンドラ起点の 1 回きりの取得は `resultFetcher`**
  （`ResultAsync<T, ApiError>`）。受け皿になる SWR が無いので、失敗は値で返さないと消える。
  現在の該当箇所は本の削除（`ShelfPage`）・ハイライトの作成（`useAskAboutSelection`。
  質問するときも色だけ・メモだけで作るときも同じ口）・ハイライトの色とメモの変更
  （`useHighlights` の `updateHighlight`）・ハイライトの削除（`useHighlights`）・
  チャット履歴の取得（`AppPage`）・読書位置の保存（`useReadingStateSync`）・
  ログイン（`RequireSession`）・ログアウト（`SettingsMenu`）・
  Dropbox フォルダの保存（`ShelfPage` → `DropboxFolderDialog`）・
  本の題名の変更（`ShelfPage` → `BookTitleDialog`）・ページめくりの向きの保存
  （`usePageDirection`）・目次の生成（`useReaderOutline`）の 12 個。
  **例外は `usePdfDocument.ts` の `storeCoverIfMissing` / `storeOutlineIfMissing` の 2 つ**で、
  これらは失敗を出さないと決めた書き込み（下記「意図的に握りつぶす」）なので
  `fetcher` + try/catch のままでよい
- **アップロードだけ `postWithProgress`**（`fetcher.ts`。返すものは `resultFetcher` と同じ
  `ResultAsync<T, ApiError>`）。**`fetch` は上りの進捗を報せられない**ので、ここだけ
  `XMLHttpRequest` を通す。本はこのアプリが送る唯一の「進み具合を見せないと止まって
  見える大きさ」のもの（22MB を上げるだけで実測 76 秒。上記「本を開くまでの往復を
  増やさない」）。**上りの progress は `request` ではなく `request.upload` 側のイベント**。
  **拒否の言葉は `readRefusal` に戻して揃える**——XHR の応答を `Response` に組み直して
  から通すので、文言が二重にならない。**`load` リスナの中から例外を出さないこと**——
  あそこでの throw は Promise をどちらにも settle させず、読者は終わらない覆いの前に
  残される。ブラウザが畳んだリクエストが持つ 200〜599 の外のステータスは `Response` に
  組み直せないので、`networkFailure` に落とす（`fetcher.test.ts` の
  「hands back a failure rather than waiting forever…」が唯一の見張り）。
  呼ぶのは `useOpenPdfBook` 1 箇所で、抽出の失敗も同じ結果に載せるため公開型だけ
  `ApiError` ではなく `Error` に広げてある。`createRequest` はテストの差し替え口
- **`ApiError` の `kind`** は `http`（サーバが拒否した）/ `parse`（返ってきた形が違う）/
  `network`（応答が無い）。`parse` は `fetcher` も立てるので throw 経路にも現れる。
  `network` を作るのは `resultFetcher` と `postWithProgress` の 2 つだけ（`fetcher` は
  fetch の reject を包まない）。
  クライアント固有の `code` は `fetcher.ts` の `CLIENT_ERROR_CODES` に集約してあり
  （`UNKNOWN` / `INVALID_RESPONSE` / `NETWORK_ERROR` / `ABORTED`）、**リテラルで書かないこと**——
  `ApiError.code` は `string` なので typo しても型で落ちない
- **レンダー中の throw は Result では拾えない**ので、`src/front/routes.tsx` が両ルートに
  `errorElement`（`src/front/components/RouteErrorBoundary.tsx`）を張る

**表示する文言は、それを描くコンポーネントが組み立てる。**フックは理由（サーバや例外の
`message`）だけを返す——`usePdfDocument` / `usePdfOutline` / `useAskAboutSelection` /
`useReadingStateSync` / `PdfPage` の `onError` はすべてこの形で、前置きは `PdfViewer` /
`PdfOutline` / `AppPage` が付ける。
**例外は `chatErrorAtom` ただ 1 つ**で、書き手が複数（送信の失敗と履歴の取得失敗）・読み手が
1 つ（`ChatArea`）なので、完成した文を atom が持つ。

失敗の受け皿と表示場所は次のとおり。新しい失敗を足すときはこの表のどれかに合流させる:

| 失敗                                         | 受け皿                                                | 出る場所                                                                             |
| -------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 本棚の読み込み・削除・追加・ドロップの拒否   | `ShelfPage` の `actionError` と SWR の `error`        | 本棚上部の赤い枠                                                                     |
| 追加する本の OCR（中止は失敗に数えない）     | `ShelfPage` の `actionError`（`importFailed`）        | 本棚上部の赤い枠                                                                     |
| OCR の行の取得                               | `useOcrText` の `error`                               | ビューア上部（ページは描く。文字が選べないことを言う）                               |
| Dropbox の本の取得・取り込み                 | `ShelfPage` の `actionError`                          | 本棚上部の赤い枠                                                                     |
| Dropbox フォルダの一覧                       | `ShelfPage` の Dropbox 側 SWR の `error`              | 本棚上部の赤い枠（本棚の失敗とは別の段）                                             |
| Dropbox フォルダの保存                       | `DropboxFolderDialog` の `error`                      | ダイアログの中（開いたまま）                                                         |
| 本の題名の変更                               | `BookTitleDialog` の `error`                          | ダイアログの中（開いたまま。打った題名も残る）                                       |
| 本の読み込み                                 | `useBook` の `error` → `bookError` prop               | ビューア中央とチャットパネル                                                         |
| PDF バイナリの取得・pdf.js の構築            | `usePdfDocument` の `error`                           | ビューア中央                                                                         |
| ページの描画                                 | `PdfPage` の `onError` → `PdfViewer` の `renderError` | ビューア上部（ページを移ると消える）                                                 |
| 目次の取得                                   | `usePdfOutline` の `error`                            | 目次パネル                                                                           |
| 目次の生成（AI）                             | `useReaderOutline` の `generation.error`              | 目次パネルの「AIで目次を作る」の下（ボタンは残り、押し直せる）                       |
| ページめくりの向きの保存                     | `usePageDirection` の `error`                         | 設定メニュー（⚙）の「ページめくり」の下（向きは保存前のまま）                        |
| ハイライトの保存（質問・色・メモのどれでも） | `useAskAboutSelection` の `saveError`                 | ビューア上部（ポップオーバーは開いたまま。狭い画面では提示バーか入力欄が開いたまま） |
| ハイライトの色とメモの変更                   | `HighlightEditor` の `error`                          | 編集欄の中（開いたまま。打ったメモも残る）                                           |
| ハイライトの削除                             | `HighlightListPanel` の `actionError`                 | ハイライト一覧の検索行の下（次の削除で消える。下記の例外あり）                       |
| ハイライトの検索                             | `useHighlightSearch` の `searchError`                 | 同じ枠。削除の失敗が出ている間はそちらが優先される                                   |
| 本文の検索                                   | `useBookTextSearch` の `searchError`                  | 本文検索パネルの入力行の下                                                           |
| チャットの送信・履歴の取得                   | `chatErrorAtom`                                       | チャットパネル（狭い画面ではシート）                                                 |
| リンク先の passage が見つからない            | `useReadingLocation` の `passageMiss`                 | ヘッダ直下の帯                                                                       |
| 読書位置の保存                               | `useReadingStateSync` の `saveError`                  | ヘッダ直下の帯                                                                       |

`chatErrorAtom` だけ二重の口がある。**atom が表示の正、`sendMessage` の戻り値
（`ResultAsync<string, ApiError>`。成功時の値は保存された回答の id）は呼び出し元の
フロー制御用**という分担で、戻り値を捨てた呼び出し元があっても画面が無言にならないように
してある。新しい送信の開始と、別のハイライトを開いたときにクリアする。

#### 意図的に握りつぶす

次の 13 行は失敗を画面に出さない（`HighlightListPanel.tsx` の行だけは、出す場所が残って
いれば出す）。いずれも理由をコメントに書いてあり、**理由を書かずに握りつぶしを増やさない
こと**:

| 箇所                                                               | 握りつぶす理由                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `pdfLoader.ts` の表紙生成 / `usePdfDocument.ts` の表紙の後追い保存 | 表紙は装飾。本棚がタイトルで代替する                                                                             |
| `pdfLoader.ts` の目次抽出 / `usePdfDocument.ts` の目次の後追い保存 | 目次はチャットの抜粋を絞るだけ。読めなくても書けなくてもページ窓で動き、本を開くことを止める方が読者の損         |
| `sseParser.ts` / `llmService.ts` の断片パース                      | ストリームの 1 ブロックが壊れても残りは使える                                                                    |
| `routes/pdf.ts` のクライアント切断後の送信                         | throw を通すと回答の保存に届かない                                                                               |
| `pdfService.ts` の `readPositionData`                              | 壊れた 1 行で本ごと開けなくしない（下記「`positionData` の正準形」）                                             |
| `chatService.ts` の `readCitations`                                | 出典が読めなくても回答そのものは見せる                                                                           |
| `textFragment.ts` のリンク解析                                     | 解析できない = passage へのリンクではない、という正常系                                                          |
| `pdfOutline.ts` の `resolvePageNumber`                             | dest が解けない 1 項目はページ無しで並べ、残りは使える                                                           |
| `documentExcerpt.ts` の `readStoredOutline`                        | 壊れた目次 1 列でチャットを止めない。ページ窓で動く                                                              |
| `useReadingStateSync.ts` の離脱時の flush                          | 送る先の画面がもう無い（本棚へ戻る・タブを閉じる）                                                               |
| `HighlightListPanel.tsx` の削除失敗（一覧を離れていたとき）        | 出す場所がもう無い（チャットを開くと一覧ごと畳まれる）。消えなかったハイライトはそこに在るので、戻れば試し直せる |
| `useServerConfig.ts` の取得失敗                                    | Web 検索は「あり」と仮定して進む。送ってもサーバが落とす                                                         |
| `pdfOcr.ts` の Tesseract の後始末（`terminate`）2 箇所             | 捨てる Worker を止め損ねても、本（または読者が頼んだ中止）はそれに左右されない                                   |

**報告しないためではなく報告する主体が別**という catch が 2 つある。`SelectionPopover` の
`onSubmit` / `onMark` を囲むもの（`runStore`。質問とマークの失敗は `useAskAboutSelection` が
受け持つ。ここで再 throw すると
イベントハンドラの外へ抜け、`errorElement` にも届かない）と、`usePageBaseSize` の
`getPage` を囲むもの（同じページを `PdfPage` も開こうとしていて、描けない理由はそちらが
読者に伝える。最後に分かっていた寸法を保つので、通りすがりにレイアウトが畳まれない）。

#### `positionData` の正準形

ハイライトの座標は `{ rects, pageWidth? }` が正準形で、**未知のキーは strip する**。

- 書き込み（`POST /api/pdf/:pdfId/selections`）は `validate("json", ...)` で厳格に検証する。
  ビューアは計測結果（`startIndex` / `endIndex` / `pageNumber` も持つ）を丸ごと送ってくるが、
  保存されるのは正準形だけ
- 読み出し（`pdfService.ts` の `readPositionData`）は `safeParse` + `{ rects: [] }`
  フォールバック。**ここを strict にすると正準形でない既存行のある本が開けなくなる**。
  JSON として壊れた行 1 件で本ごと 500 にしないためでもある

### pdf.js のランタイムアセット

`scripts/copy-pdfjs-assets.mjs`（`postinstall` で実行）が `cmaps` と `standard_fonts` を
`public/pdfjs/` に複製する（同じ `postinstall` で `scripts/copy-tesseract-assets.mjs` が OCR の
アセットを `public/tesseract/` に複製する。下記「テキストの無い PDF（OCR）」）。`src/front/lib/pdfjsConfig.ts` の `PDFJS_ASSET_OPTIONS` で
`cMapUrl` / `standardFontDataUrl` を渡す。

**`cMapUrl` が欠けると、出版された日本語 PDF が白紙になる**——CID-keyed フォントを描くには
CMap テーブルが要る。これを守っているのは E2E 1 本だけで（下記「E2E の前提」の
`cid-font-book.pdf`）、グリフを埋め込んだ PDF では再現しないので、cMap 周りに触ったら
そのテストを走らせること。
**`standardFontDataUrl`（埋め込まれていない標準 14 フォント）を守るテストは今のところ無い**。
ブラウザは黙ってシステムフォントに落とすため、自動で検出する手立てがない。

`src/index.css` の `.hiddenCanvasElement { display: none }` も必須。pdf.js が `<body>` に足す
計測用 canvas が既定の 300×150 でレイアウトに参加し、ページ下部に空白が出る。

**`pdfjsConfig.ts` は pdf.js の legacy ビルドを使い、そのうえで ReadableStream の
非同期イテレーションを自前で polyfill する**（`src/front/lib/readableStreamAsyncIterator.ts`）。
legacy ビルドの core-js が埋めるのは ECMAScript API だけで、非同期イテレーションは Web API
なので対象外。WebKit は iOS/iPadOS 26.x 現在（2026-08 確認）も未実装のため、polyfill を
外すと pdf.js v6 の `getTextContent` が `for await` の入口で落ち、iPad では Safari も
Chrome も（どちらも中身は WebKit）、ページ描画（`PdfPage`。全ページが
「このページを表示できません: undefined is not a function」）と本の追加（`pdfLoader` の
テキスト抽出。本棚上部の赤帯に出る）の両方が失敗する。デスクトップの Chrome / Firefox は
ネイティブ実装があるので polyfill は何もしない（Safari は 27 で実装。26 以前は polyfill が
効く）。**pdf.js の値 import は `pdfjsConfig.ts` 経由に限る**（現状それ以外は type import
のみ。直接 import すると legacy でないビルドが混入し、install より先に走りうるが、lint は
止めない）。legacy が要る理由と「本体と worker の両方が legacy でなければならない」制約は
`pdfjsConfig.ts` 冒頭のコメントが正。
テストは 2 段ある。**polyfill のループ挙動は `readableStreamAsyncIterator.test.ts`**
（完走で release・途中 break で cancel・エラーでも元のエラーのまま release・ネイティブ実装が
あれば触らない）、**install の配線は E2E の「a book still opens where ReadableStream cannot
be iterated…」**（ネイティブの iterator を消してから本を開く。Chromium にはネイティブ実装が
あるので、消さずに走る他の E2E では配線の欠落が隠れる）。**legacy ビルドの選択だけは
どのランナーも守れない**——jsdom は Node が、E2E は desktop Chromium が新しい ECMAScript API
を持つため、既定ビルドへ戻しても素通しする。そこは古い端末の実機だけが検出する。

### テキストの無い PDF（OCR）

スキャンした本はページが文字の画像で、pdf.js はテキストを 1 文字も読めない。以前は `fullText` が
空のままサーバの 400 で拒まれていた。今は**取り込み時にブラウザ内の Tesseract（tesseract.js、
日本語＋英語）で文字を起こし**、起こした文字を `fullText` に、行ごとの箱を R2 に置く。サーバは
形式を区別しないので、チャットの抜粋・出典・`/locate`・本文検索はそのまま動く。

| 何を                                                      | どこが                                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| OCR が要るか・行の正規化・箱の換算・text content への変換 | `src/front/lib/ocrText.ts`（純関数。`ocrText.test.ts`）                                |
| ページを 1 枚ずつ描いて読む・進捗・中止                   | `src/front/lib/pdfOcr.ts` の `readPagesByOcr`（エンジンは `OcrEngine` で注入）         |
| Tesseract の起動（動的 import）                           | `src/front/lib/tesseractEngine.ts`                                                     |
| 取り込みへの組み込み                                      | `pdfLoader.ts` の `extractPdfData`（`ExtractOptions`）→ `useOpenPdfBook` → `ShelfPage` |
| 保存・配信                                                | `routes/pdf.ts` の `POST /pdf/open`（`ocr` フィールド）と `GET /pdf/:pdfId/ocr`        |
| front と server が交わす形                                | `src/shared/schemas/ocr.ts`（`ocrTextSchema`）                                         |
| ページへの重ね方                                          | `PdfViewer` が `useOcrText` で読み、`PdfPage` の `ocrLines` へ渡す                     |
| アセットの複製                                            | `scripts/copy-tesseract-assets.mjs`（`postinstall`）                                   |

- **判定はページの非空白文字数**（`pagesNeedingOcr`）。`MIN_PAGE_TEXT_CHARS` = 8 未満のページを
  「文字が無い」とし、**それが全ページの過半数のときだけ** OCR する。そのとき読むのは文字の無い
  ページだけで、pdf.js が読めるページは自分のテキストのまま。0 ではなく 8 なのは、スキャン本には
  ノンブルやスキャナが残したゴミ文字だけのページがあるため。過半数なのは、図版ページが数枚ある
  普通の本を数分の OCR に巻き込まないため（図版ページは選ぶ文字が無いので失うものも無い）
- **OCR しても全ページが空なら取り込みを止める**（`NOTHING_TO_READ`。「このPDFからは文字を
  読み取れませんでした」）。サーバの 400（`Missing fullText`）は残っていて、読者がそれを見る
  ことは無い
- **1 ページずつ描いて読み、canvas を空にしてから次へ**（`readPagesByOcr`）。倍率は
  `OCR_RENDER_SCALE` = 2（10pt の本文が約 28px になり、日本語のモデルがよく読む大きさ）で、
  長辺を `MAX_OCR_RENDER_SIDE` = 3000px で頭打ちにする（ポスター大のページで数百 MB の canvas を
  作らない）。canvas は `width = height = 0` にして画素を手放し、`page.cleanup()` を呼ぶ
- **行単位で保存する**（単語単位ではない）。保存する箱はスケール 1 の viewport 座標（左上原点、
  `/Rotate` 適用後）で、ページをどの大きさで描いても同じ数値で重なる。行の文字は
  `normalizeOcrLine` が整える——**Tesseract は日本語の 1 文字ごとに空白を入れる**ので、和文の
  隣の空白を落とす（引用やコピーが「日 本 語」になるのを防ぐ。英単語の間は 1 つに畳んで残す）。
  ページの本文は行を `\n` で繋ぐ
- **ページへの重ね方は pdf.js 公式の `TextLayer` に任せる**（`ocrTextContent` が OCR の行を
  pdf.js の text content の形に着せ替え、`PdfPage` はそれを `getTextContent()` の代わりに
  渡す）。自前で span を並べないので、`.textLayer` の CSS 契約（`--font-height` / `--scale-x`）・
  `data-page-number` / `data-text-item-index` の付与・`endOfContent` のガード・
  `pdfTextMatcher` / `locateQuoteInSpans` がそのまま効く。各行の transform は
  スケール 1 の viewport の逆行列で**ページ自身の空間**に戻す（TextLayer はページ空間で配置し、
  回転はコンテナに CSS で掛けるため）。行の幅は箱の幅を `width` に渡し、TextLayer が span を
  その幅に伸ばす（代わりのフォント `sans-serif` の字幅に引きずられない）。ベースラインは
  `OCR_ASCENT` = 0.8（pdf.js 自身の既定値）で置くので、span の上端は箱の上端から行の高さの
  1 割程度ずれうる
- **割り切り**: 選択の粒度は行の中で文字幅が均等という近似（`--scale-x` で伸ばすだけ）。和文は
  ほぼ等幅なので合うが、欧文の行は語の途中で数文字ずれうる。**縦書きは読めない**（`jpn` の横書き
  モデルだけを使い、`jpn_vert` は持たない）。手書き・低解像度のスキャンの精度は Tesseract 次第
- **アセットはすべて自前で配る**（tesseract.js の既定は jsdelivr）。`postinstall` が
  `public/tesseract/`（gitignore 済み）へ複製する: Worker（`worker.min.js`）、コアは LSTM 版の
  3 つ（`tesseract-core-{,simd-,relaxedsimd-}lstm.wasm.js`。ブラウザの WebAssembly 対応で
  Worker が 1 つ選ぶ）、言語モデルは `@tesseract.js-data/{jpn,eng}` の `4.0.0_best_int`
  （gzip で 2MB と 3MB）。理由は 3 つ——**本の読み取りが第三者の CDN の稼働に左右されない**、
  **Worker・コア・モデルの版がビルドしたものと必ず揃う**、**E2E がネットワーク無しで本物の OCR を
  回せる**。代償はデプロイする静的アセットが約 17MB 増えること（OCR する本を足すときにしか
  取りに来ない。Workers の 1 ファイル 25MiB 上限の内側）。float 版のモデル（16MB / 11MB）は
  印刷された本では読みが変わらないので配らない。モデルは Tesseract 自身が IndexedDB に
  キャッシュする。CSP は張っていないので制約は無い（張るなら `worker-src blob:` と
  `wasm-unsafe-eval` が要る——Worker は blob から `importScripts` で起動する）
- **tesseract.js は `tesseractEngine.ts` の中で動的 import する**。OCR する本を足さない読者は
  ライブラリ（17KB のチャンク）すら読まない
- **進捗と中止**: 本棚の覆いに `recognizing` の段階が加わり「文字を読み取り中 12/200 ページ」と
  数える（エンジンの読み込み中は 0/N。最後のページを読み終えたら「本を読み取り中...」へ戻す——その先に中止で止まるものは無い）。この段階の間だけ覆いに「中止」ボタンが出て、押すと
  `AbortController` が `readPagesByOcr` を止める——読みかけのページも待たない
  （`untilAborted`）。Tesseract の Worker は `terminate` し、エンジンの起動中に中止したら
  起動し終えたところで止める。中止は `AbortError` として `useOpenPdfBook` の結果に載り、
  `ShelfPage` の `importFailed` は**名前で中止を見分けて何も言わない**（読者が頼んだことなので）。
  アップロードは始まっていないので何も保存されない。`asError` が `DOMException` の名前を保つのは
  この見分けのため
- **保存は R2 の `ocr/<sha256>.json`**（D1 ではない。1 冊で 1MB 程度になり、読むのはビューア
  だけでクエリはしない）。`POST /pdf/open` の任意の `ocr` フィールド（JSON のファイル）を
  `ocrTextSchema` で検証して書き、**壊れていれば 400**（`Invalid OCR text`。文字の選べない
  スキャン本を黙って作らない）。**同じ本を OCR 無しで取り込み直したら消す**（他のメタデータと
  同じく最新の抽出が勝つ）。本の削除でも消す
- **D1 に列は足していない**（マイグレーション無し）。本が OCR の行を持つかは `readPdf` が R2 の
  head で見て `hasOcr` として返す（表紙の head と同じ `Promise.all` に並ぶので往復は増えない）。
  アップロード直後の先充填は抽出結果から正確に立てる
- **ビューアは `hasOcr` のときだけ `GET /pdf/:pdfId/ocr` を読む**（`useOcrText`。
  `useSWRImmutable`）。行は本のハッシュで保存され同じバイト列のアップロードしか書かないので、
  `/file` と同じ `private, max-age=31536000, immutable` + ETag（`onlyIf` で 304）。
  **アップロード直後は `useOpenPdfBook` が `ocrKey(id)` に先に置く**ので取りに行かない。
  行が届く前に描いたページはテキストレイヤーが空のまま描かれ、届いたら描き直す（`ocrLines` が
  `PdfPage` の effect の依存に入っている）。取得に失敗したらビューア上部に出す——ページは
  描けるので読めるが、選択も印も効かない
- **既に取り込まれたテキストの無い本は無い**前提（以前は 400 で取り込めなかった）。後追いで
  OCR する口は作っていない
- **同じスキャン本を取り込み直すと OCR もやり直す**（数分）。取り込み済みかをサーバに先に聞く
  口は無い

守っているテストは次のとおり:

| 何を                                                   | どのテスト                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 判定・正規化・箱の換算・text content（回転を含む）     | `src/front/lib/ocrText.test.ts`                                                                                                             |
| 1 ページずつ・進捗・canvas の解放・中止・起動前の中止  | `src/front/lib/pdfOcr.test.ts`（偽のドキュメントと偽のエンジン）                                                                            |
| `ocr` フィールドの送り方・先充填・中止と進捗の受け渡し | `src/front/hooks/useOpenPdfBook.test.tsx`                                                                                                   |
| 覆いの「文字を読み取り中 N/M ページ」・中止            | `src/front/pages/ShelfPage.test.tsx`                                                                                                        |
| 取得失敗の表示・テキストのある本では取りに行かない     | `src/front/components/PdfViewer/PdfViewer.test.tsx`                                                                                         |
| 保存・`hasOcr`・キャッシュ・strip・上書き・400・削除   | `test/worker/pdf.test.ts` の `OCR text of a book without its own`                                                                           |
| 本物の Tesseract で読み、検索の印がその行に付く        | `e2e/chatbook.spec.ts`「a scanned book is read by OCR as it is added, and what was read can be searched and marked on the page」（desktop） |

E2E は行の位置も見る——検索の印が行と同じ高さにあることと、1 行目の span がページ画像の
インクの位置（左 140px・上 160px / 1240×1754px）に重なること。`PdfPage` で `ocrLines` を
無視させると page 1 の span が現れず落ちることを確かめてある。**実際のスキャン本（数百ページ、
傾き・裏写り・縦書き混じり）での精度と所要時間は測っていない**。

### テキスト選択とハイライト

**この機能に手を入れる前に `docs/PDF_TEXT_SELECTION.md` を読むこと。** 選択位置のズレ・選択範囲の
暴走・ハイライトの欠けは、いずれも見た目では気付きにくく、原因も pdf.js の CSS 契約や DOM 順序と
いった非自明な箇所にある。実装の勘所と検証方法をそこにまとめてある。

以下は特に壊しやすい点の要約:

- テキストレイヤーは pdf.js 公式の `TextLayer` を使う（`src/front/components/PdfViewer/PdfPage.tsx`）。
  自前で span を並べると座標変換を誤って選択位置がずれる
- `src/index.css` の `.textLayer` は pdf.js 公式 CSS の移植。`--font-height` / `--scale-x` を
  `font-size` と `transform` に変換する定義を削ると、span が本文より狭くなり選択範囲がずれる
- `endOfContent` とその移動処理（`src/front/lib/textLayerSelectionGuard.ts`）が無いと、
  行末を越えたドラッグがページ全体を選択する
- 同じ canvas への並行 `render()` は pdf.js が例外を投げる。StrictMode の二重実行に備えて
  `RenderTask` を保持し再実行前に `cancel()` する
- `HighlightOverlay` はテキストレイヤーより上（`z-10`）に置きつつ、コンテナは
  `pointer-events-none`、ハイライト自身だけ `pointer-events-auto` にする。
  コンテナが pointer events を受け取るとページ全面が覆われ、選択が一切できなくなる
- 選択矩形はスクロールコンテナではなく**ページ要素**基準で保存する

**ページ要素とは `data-page-container` を持つ箱**（`PdfViewer.tsx`）で、1 ページ分の canvas・
テキストレイヤー・`HighlightOverlay`・ポップオーバーがそこに同居する。見開きではこれが 2 つ
並ぶので、**どのページで測るかは現在ページから決めつけず DOM から引く**——選択は
`selection.anchorNode`（読者が押し下げた側。範囲は常に文書順なので、右から左へのドラッグでは
`startContainer` が別のページになる）から、引用箇所の印は引用が名指したページ番号から
`data-page-container` を辿る。

**2 ページにまたがったドラッグは、押し下げたページの分だけを取る**
（`selectionRects.ts` の `rangeWithinPage` が範囲をそのページのテキストレイヤーで切り、
`pdfTextMatcher.getSelectionFromTextLayer` はその切った `Range` を受け取る）。矩形は 1 ページの
ピクセルで保存されるので、2 ページ目の分は行き場がない——切らずに測るとページの外まで伸びた
矩形がそのまま保存される。E2E の「keeps a drag that runs on to the next page…」が守る。

**質問ボックスが出ている間、コピーを答えるのは `SelectionPopover`**。あの入力欄が
フォーカスを取った時点でブラウザ自身の選択は collapse しており、`pendingOn` が描く
オーバーレイと `.textLayer ::selection` の透明化のせいで**選択されたままに見える**ので、
何もしないと Cmd+C はクリップボードを更新しない（読者には古い内容が貼り付く）。
ボックスは document の `copy` を購読し、渡された `quote`（＝ `popoverState.selectedText`）を
`clipboardData` に書いて `preventDefault` する。ガードは 2 つで、**入力欄の中に選択がある
とき**（読者が打った文をコピーしている）と、**どこかに生きた選択が残っているとき**
（チャットの回答など。ブラウザ自身がコピーできる）は手を出さない。
**外側クリックで閉じるのは左ボタンだけ**——右クリックはキーボードを使わずに
コピーする経路で、そこで閉じると `handlePopoverDismiss` の `removeAllRanges` が
メニューの出る前に選択を消す。守っているのは jsdom の `SelectionPopover.test.tsx`
（傍受・2 つのガード・解除・右クリック）と `PdfViewer.test.tsx` の配線 1 本、
そして E2E の「copies the passage a reader chose with the question box over it」。

### EPUB は章をページとして読む

EPUB にはページが無い（幅でリフローする）。**spine の 1 項目（章）を 1 ページとして扱う**ことで、
`pageCount` / `pageNumber` / 読書位置 / 目次 / 章の範囲 / 引用の `findPageNumber` /
`/locate` を PDF と同じ仕組みのまま使う。`fullText` は章ごとの本文を `\f` で繋いだもので、
サーバは形式を区別せずに抜粋と出典を扱う。

| 何を                                       | どこが                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 形式の判定（バイト列の先頭 `PK\x03\x04`）  | サーバ `pdfService.ts` の `bookFormatOf`、クライアント `lib/bookLoader.ts` の `isEpubFile`           |
| zip の展開・spine・目次（nav / NCX）・表紙 | `src/front/lib/epub.ts`（`fflate`）                                                                  |
| 章の無害化と本文の抽出                     | `src/front/lib/epubContent.ts` の `renderChapter` / `chapterPlainText`                               |
| 取り込み（`ExtractedPdfData` を作る）      | `src/front/lib/epubLoader.ts`。`useOpenPdfBook` の既定の抽出は `extractBookData` で形式を振り分ける  |
| 表示                                       | `src/front/components/EpubViewer/EpubViewer.tsx` と `hooks/useEpubDocument.ts`                       |
| 文字位置 ⇔ `Range`、引用の照合             | `src/front/lib/epubTextRange.ts`                                                                     |
| 画面への割り付けとめくりの算術（純関数）   | `src/front/lib/epubPaging.ts`（文字位置 ⇔ 画面は `epubTextRange.ts`）                                |
| 今の画面とめくり                           | `src/front/atoms/epubAtom.ts`（`epubScreenAtom` / `turnEpubAtom`）、`EpubViewer/EpubPageStepper.tsx` |
| 本全体の %・今いる目次項目（純関数）       | `src/front/lib/epubProgress.ts`（`mapEpubBook` / `epubProgress`）、結果は `epubProgressAtom`         |

- **形式はファイル名ではなくバイト列で決める**。`pdfs.format`（`0008_add_book_format.sql`。
  既定は `'pdf'`）に保存し、R2 のキーの拡張子と `/file` の `Content-Type` もそれに従う。
  削除は `pdfObjectKey` ではなく保存時の `file_path` を消す
- **ビューアの切り替えは `AppPage` が `book.format` で行う**。本が届くまでは `PdfViewer` を
  描く——`usePdfDocument` が本を待たずに取得を始める性質（上記「本を開くまでの往復を
  増やさない」）を EPUB のために崩さないため。代わりに **`usePdfDocument` は ZIP のバイト列を
  受け取ったら pdf.js に渡さず黙って待つ**。ここを外すと、URL から EPUB を直接開いたときに
  本が届くまでの間「PDFを表示できません」が出る
- **章の HTML は許可リストから作り直す**（`renderChapter`）。出版社の要素・属性を
  フィルタするのではなく、許可した要素と属性だけで新しい DOM を組むので、イベントハンドラや
  `javascript:` が見落としで残ることがない。script / style / フォーム / 埋め込みは中身ごと捨て、
  知らない要素は中身だけ残す。**出版社の CSS は読まない**（`index.css` の `.epubChapter` で
  描く）。id は `epub-` を前置し（アプリの id と衝突させない）、本の中へのリンクは
  `data-epub-href` に移して `EpubViewer` が章送り＋アンカーへのスクロールで辿る。外へのリンクは
  新しいタブ。画像は `useEpubDocument` が blob URL にし（`image/*` だけ）、本を離れるときに
  解放する。**組んだ要素は React に文字列で渡さず `replaceChildren` で差し込む**——もう一度
  パースさせない
- **ハイライトは矩形ではなく章本文の文字オフセットで保存する**（`positionData.textRange`。
  章要素の `textContent` に対する `[start, end)`）。章は幅で折り返しが変わるので、保存時の
  矩形はすぐにずれる。`EpubViewer` は描くたびに `rangeOfTextOffsets` → `selectionOnPage`
  で矩形を測り直す（ペインと章の `ResizeObserver` が `drawnSize` を変えると再計測。E2E の
  「…its highlight follows the text as the pane changes width」がスプリッターでペインを狭めて
  見張る——広いペインは見開きになり 1 段の幅がほとんど変わらないので、パネルを畳む方向では
  行が組み変わらない）。`rects` は質問を
  書いている間の仮表示と、`textRange` の無い行のためにだけ残る
- **引用の印は `locateQuoteInSpans` をそのまま使う**。章のテキストノードを pdf.js の
  テキスト項目に見立てる（`rangeOfQuote`）。章は 1 画面に収まらないので、印を付けたら印のある
  画面へめくる（下記「画面ごとにめくる」）。一覧から開いたハイライト・本文検索の結果・章の中への
  リンクも同じ
- **表紙は manifest の `cover-image`（無ければ `<meta name="cover">`）**を 240px の webp に
  する。描けなければ PDF の表紙と同じ理由で握りつぶす（`epubLoader.ts` の
  `renderEpubCover`）。目次が読めない EPUB は目次なしとして開く（`epub.ts` の `openEpub`）
- **目次の項目は章内のアンカーまで持つ**（`OutlineEntry.anchor`。`epub.ts` が nav / NCX の href の
  fragment を残す）。1 つの spine 項目に 7.1〜7.5 が入っている本では、章（＝ページ）だけでは節を
  区別できないため。目次から飛ぶと `EpubViewer` の `goToPlace` が章内リンクと同じ道でアンカーの
  画面を開き、読んでいる位置（`readingOffsetRef`）を**アンカーの文字位置**に置く（画面の先頭に
  すると、画面の途中から始まる節が「まだ読んでいない」ことになり目次の強調が前の節に残る）
- **読者に見せる位置は spine 番号ではない**（下記「本全体の % と今いる節」）
- **EPUB に無いもの**: ピンチ・ズーム（中央のダブルタップも何もしない）、章の中の位置の保存
  （リロードと別端末では章の先頭に戻る。下記）、右開き（めくる向きの写像は 1 箇所にまとめて
  あるが、配線していない）

#### 画面ごとにめくる

Kindle と同じく、章を**ペインの大きさの画面に割って 1 画面ずつめくる**。割り付けはブラウザに
任せる——章を CSS の段組み（`index.css` の `.epubColumns`。高さはペインいっぱい、
`column-fill: auto`）で組むと、収まらない分が右へ段として並ぶので、それを `overflow: clip` の
紙（`<article>`）で切り抜き、中の箱（`data-page-container`）を `translateX` で 1 画面ずつ送る。
**画面はクライアントだけの概念**で、サーバ・抜粋・引用・読書位置・目次・`pageNumber`・`?page=` は
どれも今までどおり「章 = 1 ページ」のまま。

- **1 画面 = 段 1 つと段間 1 つ**。段の間隔は余白（`--epub-page-margin`）の 2 倍、章の両端にも
  余白を 1 つずつ取るので、どの画面も左右に同じ余白を持ち、1 回のめくりはちょうど画面の幅になる。
  画面の幅は `pagedLayout`（`epubPaging.ts`）が決め、**最大 672px**（`MAX_SCREEN_WIDTH_PX`。
  スクロールで読んでいた頃の `max-w-2xl`）。**ペインに 440px（`SPREAD_MIN_SCREEN_WIDTH_PX`）の
  画面が 2 つ入るなら見開き**で、段を 2 つ並べて 1 画面と数える。PDF の見開きと同じく判定は
  ペインの実測だけで、パネルの開閉は見ない（desktop の 1280px でチャットを畳むと見開きになる）
- **画面の数は段組みの `scrollWidth` から数える**（`screenCount`）。段は章の箱の外へはみ出して
  並ぶので、`scrollWidth` が全段の幅になる。章の画像が届くと段が組み直されるので、`load` を
  capture で拾って数え直す。**画像は 1 画面の高さを超えない**（`--epub-column-height`）——
  超えると 2 画面に切れる
- **今の画面は `epubScreenAtom`**（`{ page, screen, count }`）。`page` はどの章について数えたかで、
  **今の章を名指していなければ先頭の画面として読む**（`shownScreen`）。目次・引用・URL・本文検索
  など章を動かす口は `currentPageAtom` だけを書けばよく、画面を 0 に戻す書き込みを足す必要が無い。
  両方を書くのはめくり（`turnEpubAtom`）だけで、前の章へ戻るめくりは `screen: "last"` を書いて
  章の最後の画面に着地させる。保存も URL も持たない（本ごとのストアに載るだけ）
- **めくりの算術は `turnEpub` 1 つ**——次の画面、章の最後なら次の章の最初、前の画面、章の最初
  なら前の章の最後、本の両端では動かない。キー・端のタップとクリック・スワイプ・下部の
  `EpubPageStepper`（狭い画面は `PageToolbar` の `stepper`）が全部 `turnEpubAtom` を通る。
  `←` / `→`・`h` / `l`・emacs の `C-b` / `C-f` は画面をめくり、**`↑` / `↓`・`j` / `k` も
  前後の画面へめくる**（emacs の `C-n` / `C-p` も。スクロールするものが無いため）。`gg` / `G`
  （emacs の `M-<` / `M->`）と目次は章の先頭へ
- **めくりの向きは PDF と同じ本の設定（`book.pageDirection`）で、左右を前後に読み替えるのも PDF と
  同じ `turnToward`（`touchNavigation.ts`）**。`EpubViewer` は `book` から向きを読み、端のタップと
  スワイプは向きを `resolveTapZone` / `resolveSwipe` に渡す。**キーは `useKeyboardShortcuts` に
  向きを渡し、返ってくる `nextPage` / `prevPage` をそのまま前後として使う**——方向キーと `h` / `l` は
  向きで読み替え済み、emacs の `C-f` / `C-b` はもともと左右を名指さない。ここで左右に読み直すと
  右開きで二重に反転し、`C-f` が戻る。`EpubPageStepper` は `AppPage`（狭い画面）と `EpubViewer`
  （広い画面）が `direction` を渡す。**画面の並びそのものは右開きでも左から右**——本文は横書き
  なので、列を右から並べ替えるのは縦書きに対応するときの話。jsdom の「turns on with ← in a book
  that opens on the right」「turns on with emacs C-f whichever way the book opens」が見張る
- **端のタップは PDF と同じ規則**——押した時点で送れるか（ポップオーバーが無く選択が畳まれて
  いる）を控え、12px / 500ms 以内、2 打目以降・ボタンとリンクの上では送らない。中央は何もしない。
  スワイプも PDF と同じ `resolveSwipe`（React の `onTouchStart` / `onTouchEnd`。止めるべき既定が
  無いので passive でよい）
- **読んでいる場所は画面番号ではなく章本文の文字位置で持つ**（`EpubViewer` の
  `readingOffsetRef`）。めくったら画面の最初の文字の位置（`textOffsetOfScreen`）、引用・
  ハイライトへ移ったらその passage の始まりを控え、**ペインの幅・高さ・見開き・書体・画像で
  組み直したら、その文字のある画面へ戻す**（`screenOfTextOffset`）。組み直しの間は控えた位置を
  更新しない——毎回「画面の先頭」に取り直すと、幅を変えるたびに少しずつ前へずれていく。
  E2E の「an EPUB stays on the words being read when the pane changes width」が見張る
- **どの経路で画面が変わったかは `placedRef`（前回の割り付け）と比べて決める**——章が替わった
  （リンクのアンカー → `"last"` → 頼まれた画面 → 先頭）、組み直した（文字位置の画面）、それ以外
  （atom が頼んだ画面）。どれも `useLayoutEffect` なので、読者は途中の画面を見ない
- **ハイライト・選択・印の矩形は送る箱（`data-page-container`）基準**で、オーバーレイも同じ箱に
  載っているので、どの画面を出していても語に張り付く。矩形の x から画面を引くのが
  `screenOfX`（`x ÷ 画面の幅`）。浮かぶ質問ボックスは今の画面の内側に収める
- **章の中の位置は保存しない**——`readingState` は章番号のまま（列を足さない）。リロード・
  本棚から開き直す・別端末では**章の先頭の画面に戻る**。章は数画面〜十数画面なので許容している
- **画面番号は表示だけ**（`EpubPageStepper` の 2 段目の「この章 `3 / 12`」）。見開きでは
  2 段で 1 画面と数えるので、同じ章でも幅で総数が変わる

守っているテストは次のとおり:

| 何を                                                     | どのテスト                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 画面の幅・見開き・数・めくりの算術・左右の写像           | `src/front/lib/epubPaging.test.ts`                                                     |
| 文字位置 ⇔ 画面                                          | `epubTextRange.test.ts`「textOffsetOfScreen / screenOfTextOffset」                     |
| atom のめくり（章をまたぐ・`"last"`・他の口で動いた章）  | `src/front/atoms/epubAtom.test.ts`                                                     |
| 表示と山括弧                                             | `EpubPageStepper.test.tsx`                                                             |
| キーと端のタップの配線（jsdom は 1 章 1 画面）           | `EpubViewer.test.tsx`                                                                  |
| 実際にめくれる・章をまたぐ・戻ると章の最後               | `e2e/chatbook.spec.ts`「an EPUB turns a screen at a time…」                            |
| 幅を変えても同じ語の画面にいる                           | 同「an EPUB stays on the words being read when the pane changes width」                |
| リンク先・検索結果の画面へめくる                         | 同「an EPUB added from the shelf…」（`toBeInViewport`）と「searching an EPUB's text…」 |
| 指の端タップとスワイプ                                   | `e2e/mobile.spec.ts`「turns an EPUB a screen at a time at the edges and with a swipe」 |
| 目次の節を押すと節の画面が開き、目次と下部表示が節を示す | `e2e/chatbook.spec.ts`「an EPUB's contents take a section to its own screen…」         |

**E2E で「見えている」を言うときは `toBeVisible` ではなく `toBeInViewport`**——隣の画面の段も
描かれていて、紙に切り抜かれているだけなので、`toBeVisible` は別の画面にある語でも通る。
**fixture の第 2 章と第 3 章は数画面ぶんの埋め草の段落を持つ**（`testEpubManifest.ts` の
`filler`）。第 1 章は短いまま（選択とハイライトの E2E がその最初の段落を使う）。

#### 本全体の % と今いる節

spine 項目は**ファイルの切り方であって本の切り方ではない**——1 項目が 5 節ある章まるごとのことも、
扉 1 枚のこともある。「9 / 17 章」「7 / 100」は読者に何も言わないので、Kindle と同じく
**本全体の % と、今いる目次項目の題名**で言う（`EpubPageStepper`。1 段目が項目名、2 段目が
「42%　この章 3 / 12」。目次の無い本は 2 段目だけ）。

- **% は文字数で数える**（`epubProgress.ts` の `bookPercent`。章ごとの文字数は
  `mapEpubBook` が全章を `renderChapter` で組み直して `textContent` の長さを取る。ハイライトの
  `textRange` と同じ尺度）。本を開いたとき 1 回だけ、ページに入れずに組む。切り捨てなので
  100% は本の最後だけ
- **目次項目の位置は（章, 章内の文字位置）**（`OutlineEntry.offset`。アンカーの要素より前の
  文字数）。今いる項目は `pdfOutline.ts` の `findActiveEntry(entries, page, offset)` が選ぶ——
  PDF は offset を渡さず（＝そのページの項目はすべて到達済み）、従来の挙動のまま。
  **見つからないアンカー**（`renderChapter` が id ごと捨てた要素など）は章の先頭ではなく、
  次に見つかった項目の直前（無ければ章末）に置く。先頭に置くと章全体で「到達済み」になり、
  同点は後の項目が勝つので、本当に読んでいる節から強調を奪う
- **値を出すのは `EpubViewer`**——本の文字数と読んでいる位置の両方を持つのはそこだけなので、
  `epubProgress` の結果を `epubProgressAtom` に書き、ステッパー（ビューアの下と `PageToolbar`）が
  読む。サーバの値の写しではない（どちらもクライアントで組み直した値）
- **目次パネルの右の数字は EPUB では本全体の %**（`PdfOutline` の `entryLabel`）。spine 番号は
  章とその節が全部同じ値になる
- **チャットの範囲メニューは EPUB ではページ数を出さない**（`ChatScopeMenu` の `format`）。範囲の
  単位は spine 項目のまま（`chapterSpans`）。**同じ spine 項目に並ぶトップレベルの項目は保存時に
  名前をまとめる**（`epubLoader.ts` の `epubOutlineEntries`。「7.1 SAML・7.2 OAuth」）——
  `chapterSpans` は同じ開始ページの 2 つ目以降を捨てるので、まとめないと「7.1」だけを選んだ
  つもりで項目まるごとを送ることになる。既存の本は再アップロードで直る

守っているのは `epubProgress.test.ts`（% と項目の位置）、`pdfOutline.test.ts` の
`findActiveEntry`、`PdfOutline.test.tsx`（offset での強調・アンカーを渡す・`entryLabel`）、
`EpubPageStepper.test.tsx`、`epubLoader.test.ts`（まとめる）、`ChatScopeMenu.test.tsx`（ページを
出さない）、E2E の「an EPUB's contents take a section to its own screen of the chapter it shares…」。
**jsdom はレイアウトが無いので、節のある画面と目次の強調は E2E だけが見ている**。

#### 表示の設定（Kindle の「Aa」）

文字の大きさ（10 段階）・行間（4 段階）・配置（左揃え / 両端揃え）・フォント（ゴシック /
明朝）・ページの余白（3 段階）を読者が選べる。**EPUB にだけある**——PDF の書体はページの
一部なので、ヘッダーの「表示の設定」（`Aa`。`EpubViewer/EpubTypographyMenu.tsx`）は
`book.format === "epub"` のときだけ `AppPage` が出す。狭い画面でもヘッダーに置く（ヘッダーは
電話でも常に画面にあり、アイコン 2 つ分の幅はある）。

| 何を                                         | どこが                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 段階の値・既定値・スキーマ・CSS 変数への写像 | `src/front/lib/epubTypography.ts`（`epubTypographyStyle` は純関数）                                  |
| 保存                                         | `settingsAtom.ts` の `epubTypographyAtom`（`chatbook:epub-typography`）                              |
| 適用                                         | `EpubViewer` が `<article>` に CSS 変数を置き、`index.css` の `.epubColumns` / `.epubChapter` が読む |

- **本をまたいで残る読者の好み**なので、倍率と違って本ごとには持たない。壊れた値は
  `validatedStorage` が既定へ落とすが、**スキーマはフィールドごとに `.catch` する**——
  1 項目だけ範囲外の値（段階を減らした後の古い値など）で、ほかの選択まで失わないため。
  オブジェクトでないものは丸ごと既定値になる
- **既定値は設定ができる前の見た目そのもの**（17px・1.9・左揃え・余白は
  電話 20px / `md` 以上 40px）。**ゴシックの先頭は `ui-sans-serif, system-ui`**——日本語の
  ゴシックを先頭にすると欧文の字幅が変わって行の折り返しが動き、幅でのリフローを見る E2E
  （「…its highlight follows the text as the pane changes width」）が行数の前提ごと落ちた。
  明朝は和文フォントを先頭に置く（欧文セリフが先だと仮名がシステムのゴシックに落ちる）。
  Web フォントは読み込まない
- **設定はハイライトと引用の印の再計測と、画面の割り付け直しのきっかけに入る**（`EpubViewer`
  の `useLayoutEffect` の依存に `typography`）。**段組みでは章の箱の寸法は画面が決める**ので、
  文字を大きくしても行間を広げても箱は変わらず（段が増えるだけ）、`ResizeObserver` は何も
  聞かない。jsdom の「measures its highlights again when the reader changes the type, even
  where the box keeps its size」と、E2E の「an EPUB is drawn larger on the type settings…」が
  これを見張る
- **設定を変えても読んでいた語の画面に留まる**。書体を変えると章は組み直され、画面の数も
  変わるが、読んでいた場所は画面番号ではなく章本文の文字位置で控えてあるので、その文字の
  ある画面へ戻る（上記「画面ごとにめくる」。幅を変えたときと同じ仕組み）
- **余白は画面ごとの左右の余白**で、段の間隔（余白の 2 倍）と章の両端の余白になる
  （`index.css` の `.epubColumns`）。広げても画面は広がらず、1 行が短くなる

### チャットのストリーミング

本は 2 種類の会話を持ち、どちらも SSE でイベントは `token` / `citation` / `done` / `error`:

| 会話                       | ルート                                                |
| -------------------------- | ----------------------------------------------------- |
| ハイライトにぶら下がる会話 | `POST /api/pdf/:pdfId/selections/:selId/chats`        |
| 本そのものの会話           | `POST /api/pdf/:pdfId/chats`（本文を `scope` で指定） |

**配管は 1 箇所**——`src/server/services/chatStream.ts` の `streamChatReply` が、イベントの
送り方・保存してから `done` を送ること・切断後も保存を完走させる `waitUntil` を持つ。ルートが
持つのは履歴の読み出し・質問の保存・抜粋とプロンプトの組み立てだけ。回答の書き込みは
`routes/pdf.ts` の `saveAnswerInto` が両ルートぶんを担う（所有者は `{ pdfId, selectionId }`
で、本の会話は `selectionId: null`）。

- クライアントは `src/front/lib/sseParser.ts` の `createSseParser` で読む。
  SSE は**空行がブロック境界**で、`event:` は同じブロックの `data:` と対にする。
  バッファ全体から `data:` を検索すると同時到着したイベントが混線する
- `createSseParser` が返すのは `{ event, data: unknown }` まで。そのあと
  `src/front/hooks/useChatStream.ts` が `src/shared/schemas/sse.ts` の
  `chatSseEventSchema`（4 イベントの discriminated union）で `safeParse` し、通ったものだけ
  扱う。**キャストで済ませないこと**——未知の種別の出典が `CitationBadge` の描画に届く
- 送信は **必ず `useChatStream` の `sendMessage` を通す**。ポップオーバーからの初回質問も
  `useAskAboutSelection` 経由でここに来る。生 `fetch` にすると質問文の即時表示と
  「考え中…」が出なくなる
- **送り先は `selectionId` が決める**。`null` なら本そのものの会話
  （`/api/pdf/:pdfId/chats`）、文字列ならハイライトの会話。本の会話には**本文の範囲を
  `options.scope`（`PageRange[]`）で渡し**、送信 body では `{ ranges }` に包まれる
  （`scope` を渡さない質問では `JSON.stringify` が丸ごと落とす）。範囲を作るのは
  `src/front/lib/chatScope.ts` の `scopeRanges`（空 = 本全体 = `[{1, pageCount}]`）
- **回答を保存できなかったときは `done` ではなく `event: error`（`CHAT_SAVE_FAILED`）を送る**。
  保存前に `done` を送ると、画面には回答が出そろっているのにリロードで消える。
  ここを `.catch(console.error)` に戻さないこと
- **`CHAT_SAVE_FAILED` だけは回答を画面に残す**。他の `event: error` は生成が途中で切れた
  ことを意味するので断片を捨てるが、これは回答が完成したうえで書き込みだけが落ちた場合で、
  消すと読むこともコピーすることもできなくなる（生成コストは既に払っている）。
  `useChatStream` がこのコードで分岐し、`chatFailureMessage` も「取得に失敗」ではなく
  「保存できませんでした」と言い換える
- ポップオーバーからの初回質問は**保存された回答を待たない**。`sendMessage` の完了を待つと
  ポップオーバーが 10 秒前後ページを覆う。閉じる合図はハイライトの保存が成功したこと
  （`useAskAboutSelection`）で、ストリーム自体の失敗は `chatErrorAtom` が受ける
- **ポップオーバーは保存が終わるまで開いたままなので、送信中フラグが要る**
  （`SelectionPopover` の `asking`）。無いと 2 回目の送信がハイライトを二重に作り、
  2 本目の回答が 1 本目を `abortChatStream` で殺す。`onSubmit` を await する型なのはこのため

#### 回答の追随はどこで止まるか

- **読者が上へスクロールしたら、その回答の間は最下部への追随を止める**
  （`src/front/components/ChatArea/ChatMessageList.tsx`）。回答を最初から読もうとした読者を、
  次のトークンで足元へ引き戻さないため。追うかどうかは `followingRef`（同ファイルのローカル
  ref。初期値は追う。書き手はスクロールの判定と再開の 2 つ、**読み手は追随の effect だけ**）で、
  atom ではないので `ChatMessageList` が unmount される操作——一覧に戻る・パネルを畳む・
  シートを閉じる——のたびに初期値へ戻る
- **止める判断は方向で行う**——最下部へ寄せるのはこちらの `scrollIntoView` だけで、それは
  下向きにしか動かない（実 Chrome で、トークンごとに `scrollIntoView` を呼びながら本文を
  伸ばしたときのスクロールイベント 116 件がすべて単調増加で、止まった先が最下部ちょうど
  だったことを実測。2026-08 確認）。だから直前の位置（`lastScrollTopRef`。誰が動かしたかに
  関わらず毎イベント控えるので、追随が刻む途中経過も基準を押し上げる）より `scrollTop` が
  減ったイベントは読者のものと分かる。フラグやタイマーで「自分が動かした最中か」を数えるより
  確かで、ホイール・スクロールバー・指・キーボードのどれで動かしても同じ 1 本の判定を通る
  （下記「狭い画面のリーダーは 1 カラム」の入力の表でいう「分けない」側）
- **最下部かどうかは方向より先に見る**（`ChatMessageList.tsx` の `AT_BOTTOM_EPSILON_PX` =
  4px の許容つき）。ペインの高さが変わる操作——シートの引き上げ・スプリッターのドラッグ・
  最大化——ではブラウザが `scrollTop` を切り詰め、読者が触っていない上向きのイベントが飛ぶ。
  **切り詰められた先は定義上いつも最下部**なので、先に最下部を見れば再開の側に落ちる。許容を
  0 にすると、小数でスクロールする画面では最下部と判定されず、戻しても二度と再開しなくなる
- **止めるのはストリーミング中の上スクロールだけ**（`ChatMessageList` の `isStreaming`。
  最下部での再開はいつでも走る）。書き終わった回答を読み返す上スクロールで止めると、
  **同じ会話で次に質問したときに、その質問も回答も画面の外に出たままになる**——送信は
  `isStreaming` を true にするので、次の箇条の再開が挟まらない
- **追随の再開はスクロールの後に置く**。確定回答の append と `isStreaming` が下りるのは同じ
  コミットなので、先に再開すると、途中まで読んでいた読者を最後の 1 回だけ引きずり下ろす。
  **再開が起きるのは `isStreaming` が false になるコミット全部**で、ストリームの終了のほかに
  `abortChatStream`（一覧に戻る・`openChat` で別の会話を開く）も通る。だから会話を替えれば
  停止は残らない

守っているのは jsdom の「following the answer as it streams」9 ケース（`it` 6 本と `it.each`
の 3 ケース）。`vp exec vitest run src/front/components/ChatArea/ChatMessageList.test.tsx -t
"following the answer as it streams"` で走る。**追随のスクロールが刻む途中経過を流すテストが
方向判定の唯一の見張り**で、無いと途中経過を読者と取り違える実装が素通りする。見ていないもの
が 2 つあり、**ペインの寸法が変わる経路**（jsdom は `clientHeight` を固定値で置くので切り詰めの
イベントが起きない）と、**実ブラウザのスクロールが本当に単調かどうか**（流すのは合成した
途中経過なので、上の実測だけが根拠）はどのテストも通らない。**E2E も無い**——チャットの送信には
実キーが要る（上記「worktree を作ったら最初に `.dev.vars` を用意する」）ので、手で見るなら
メインクローンの `LLM_API_KEY` を入れ、長い回答の途中で上へスクロールする。

#### 図解は mermaid と HTML の 2 通りで書かせる

**書き分けさせるのは system prompt**（`src/server/services/llmService.ts` の
`buildSystemPrompt`）。mermaid の行の直後に HTML の行がある。**位置はテストが 2 組で
押さえている**——`MERMAID_RULE`〜`TABLE_RULE` の間を見る 1 本が HTML の行を、
`TABLE_RULE`〜`CITATION_RULES` の間を見る既存 4 本が web search の指示を固定している。
だから**新しい指示は `MERMAID_RULE` の行より前か、`CITATION_RULES` の後ろ（プロンプトの
末尾）に足す**。2 つの区間の内側に足すと、どちらかの組が落ちる。

フェンスは 2 つだけ特別扱いする。どちらも `ChatMessageBubble.tsx` の `pre` レンダラ
（`fenceRenderer(streaming)`）が検出して差し替える。

| フェンス       | 差し替え先                        | 読者に見えるもの                                   |
| -------------- | --------------------------------- | -------------------------------------------------- |
| ` ```mermaid ` | `MermaidBlock.tsx`（`ChatArea/`） | 描かれた図（描けなければコードのまま）             |
| ` ```html `    | `HtmlDiagram.tsx`（`ChatArea/`）  | キャプション付きのリンク。押すとポップアップで開く |

`HtmlDiagram` が出すのは画面を覆う `role="dialog"` のモーダルで、ページ上の選択に貼り付く
`SelectionPopover` のポップオーバーとは別物である。

**フェンス本文は `textOf` が再帰的に集める。** `language-html` は highlight.js の `xml`
文法に当たるので、`<code>` の子は text ノード 1 つではなく、`hljs-*` の span 2 つと
その間の text 2 つに割れる（2026-09-14 実測）。素朴に `children[0].value` を読むと
（`children[0]` は span なので）`null` が返り、**リンクが出ないまま黙ってコードブロックに
落ちる**（エラーは出ない）。本文そのものを見張っているのは `ChatMessageBubble.test.tsx`
の「hands the popup the answer's own html…」で、リンクが出ること自体は同じファイルの
「shows an html fence as the link…」と「names the link 図解を見る…」も見張っている。

**キャプションはフェンスの info string**（` ```html title="…" `）。**書くのはモデル**で、
書式を指示しているのは system prompt の HTML の行。読むのは `ChatMessageBubble.tsx` の
`fenceCaption`（mdast-util-to-hast が `<code>` の `data.meta` に残したものを読む）と
`src/front/lib/htmlDiagram.ts` の `captionFromMeta`。読めなければ「図解を見る」——**文言の
既定を持つのは描く側**（`HtmlDiagram`）で、`fenceCaption` は null を返すだけ。

**回答の HTML はアプリの DOM に入らない。** 見せるのはリンクだけで、文書は `iframe` の
`srcdoc` に渡す。`sandbox` は `allow-scripts` のみで、**`allow-same-origin` を足しては
いけない**——足すとフレームがアプリと同一オリジンになり、Cookie も localStorage も DOM も
読め、自分の sandbox 属性も外せる。`allow-scripts` を残すのは図が自分で描けるようにする
ため。**`srcdoc` には doctype を補う**（`asStandaloneDocument`）。無いとブラウザが後方互換
モードで組み、回答が書いた幅・高さの意味が変わる（回答が自分で書いていればそのまま）。
**mermaid 側だけは非対称**で、`MermaidBlock.tsx` は `mermaid.render` の SVG を
`dangerouslySetInnerHTML` でアプリの DOM に置く（`src/` で唯一の使用箇所）。あちらは
mermaid 自身の sanitizer（既定 `securityLevel: "strict"`）に委ねてよく、回答が書いた生の
HTML はそこを通せない。

**ストリーミング中はリンクを出さない。** `ChatMessageList` が確定メッセージとは別に描く
ストリーミング用バブルが `streaming` を渡し、`pre` はそれを読んでコードブロックのまま
据え置く。書きかけの文書を開かせないためと、開いたポップアップが回答確定で unmount する
（＝閉じる）のを避けるため。**この配線だけは `ChatMessageList.test.tsx` の 1 本が見張って
いる**（外しても他は green のまま）。

**Escape は `document` の keydown で受ける**（`SettingsMenu` / `SelectionPopover` と同じ形）。
`ConfirmDialog` のラッパー `onKeyDown` を採らないのは、**ヘッダをクリックするとフォーカスが
`body` に落ち、React の根の外側なので合成イベントが届かない**ため。同じ購読で
`stopPropagation` し、`window` でページ送りキーを読む `PdfViewer` に背後のページを送らせない
（`preventDefault` はしないのでブラウザのショートカットは生きている）。**`ConfirmDialog` は
この限りではない**（開いている間も `←` / `→` がページを送る）。

割り切りが 1 つある。**フレームの中をクリックした後の Escape は届かない**——sandbox の別
ドキュメントなので原理的に届かない（Escape を `postMessage` で送る橋は、回答の文書にこちらの
スクリプトを混ぜることになるので足さない）。閉じるボタンが常に効く道。

**HTML 側の**見張りは jsdom の 4 ファイル。`src/front/lib/htmlDiagram.test.ts`（6 本。
キャプションの書式と doctype）、`HtmlDiagram.test.tsx`（10 本。リンク・sandbox と srcdoc・
開く前は閉じている・内側クリックで閉じない・Escape・外側クリック・既定文言・body に
フォーカスがあっても閉じること・ページ送りキーの対 2 本）、`ChatMessageBubble.test.tsx` に
4 本（フェンスの差し替え・ストリーミング中の据え置き・hljs が割った本文の回収・既定文言）、
`ChatMessageList.test.tsx` に 1 本（配線）。**E2E は無い**——チャットの送信に実キーが要るため。
**jsdom は iframe の中身を 1 ピクセルも描かず `srcdoc` も読み込まない**ので、テストは
`srcdoc` / `sandbox` / `title` という渡し方までしか見ていない。そこは手で見る——メイン
クローンの `.dev.vars` に実キーを入れて `vp dev` し、mermaid で描けない図（自由なレイアウト・
並置した対比）を求める質問を送り、リンクを押してフレームの中身と DevTools の Console を見る。
**2026-09-14 に実ブラウザで確かめた記録**（1280×800 px）: リンクの文言はモデルが書いた
`title` と一致し、フレーム内の要素が描画され、フレーム内の `<script>` が走り、開いている間の
`→` はページを送らず閉じると送り、console の error / warning は 0 件だった。390×844 px でも
ポップアップは画面に収まり（358×675 px）、console は静かだった。

### LLM の呼び分け

`src/server/services/llmService.ts`。**OpenAI 互換の API であることだけが前提**で、
プロバイダごとの差を吸収する層は持たない（あるのは下記の Web 検索の可否 1 つだけ）。

**プロンプトに指示を足すときは位置に制約がある**——上記「図解は mermaid と HTML の 2 通りで
書かせる」の `MERMAID_RULE` / `TABLE_RULE` / `CITATION_RULES` が区間の区切りで、テストが
その 2 つの区間の中身を固定している。

| モード             | エンドポイント                                                                        |
| ------------------ | ------------------------------------------------------------------------------------- |
| 通常               | `<LLM_BASE_URL>/chat/completions`（OpenAI SDK 経由）                                  |
| Web 検索 ON        | `<LLM_BASE_URL>/responses` に `tools: [{ type: "web_search" }]`（生 fetch）           |
| 目次の生成（下記） | `<LLM_BASE_URL>/chat/completions`（`completeChat`。ストリームしない・SDK の再試行 0） |

`/v1` を含めるかはプロバイダの流儀次第（既定の DeepSeek は付けない）。**`LLM_BASE_URL` に
末尾スラッシュを付けると Web 検索だけが壊れる**——通常モードは SDK が正規化するが、
あちらは文字列連結なので `//responses` になる。

**接続先・モデル・Web 検索の可否は env で決まり、解決するのは `resolveLlmConfig` 1 箇所**
（既定値もそこが持つ。**値の正はここで、docs の表は写し**）。`wrangler.jsonc` の `vars` は
既定では空で、**別のプロバイダに向けるときだけ書く**——**キーしか設定していないデプロイは
DeepSeek に向く**。`vars` を足すと `worker-configuration.d.ts` が変わるので、
`vp exec wrangler types` で再生成して commit する。

| 変数                       | 空 / 未設定のとき                                                      |
| -------------------------- | ---------------------------------------------------------------------- |
| `LLM_API_KEY`              | チャットと目次の生成が 500（`CONFIG_ERROR` / `"LLM_API_KEY not set"`） |
| `LLM_BASE_URL`             | `https://api.deepseek.com`                                             |
| `LLM_MODEL`                | `deepseek-v4-flash`                                                    |
| `LLM_WEB_SEARCH_SUPPORTED` | 対応しているものとして扱う（`"false"` / `"0"` だけが否定）             |

**Web 検索の可否はプロバイダの性質であって読者の設定ではない。** 読者のトグル
（`useWebSearchAtom`、既定 ON）は localStorage にあるので、プロバイダを替えても消えない。
そのため**サーバが最終決定する**——`routes/pdf.ts` が `readerWantsWebSearch &&
llmConfig.webSearchSupported` を `buildSystemPrompt` より前で解いており、プロンプトの
「document only」指示と実際に叩くエンドポイントが食い違うことはない。
**画面側は `GET /api/config`（`src/server/routes/config.ts`。返す形は
`src/shared/schemas/config.ts` の `webSearchAvailable` 1 つだけ）を見て設定メニューから
トグルごと消す**（`src/front/hooks/useServerConfig.ts` → `SettingsMenu`）。効かないトグルを
見せないためのもので、送信を止めているのはサーバ側。**`ChatArea` / `PdfViewer` は生の atom 値を
送ったままでよい**——決定者を 2 箇所にしないため。**このエンドポイントも `requireSession` の
内側**なので、curl で確かめるならログインの Cookie が要る。

`useServerConfig` は**答えが来るまでとエラー時は「対応あり」を返す**。無いと仮定すると、
メニューを開いた読者の前でトグルが遅れて生えることになる。サーバが強制するので外れても害はない。
SWR なので、**設定を変えたあとの反映は開いているタブをリロードしてから**見る
（`revalidateOnFocus` は切ってある）。

**usage のキャッシュ計上だけはプロバイダで形が違う**。通常モードは DeepSeek 独自の
`prompt_cache_hit_tokens`、Web 検索モードは `input_tokens_details.cached_tokens` を読み、
どちらも `StreamUsage.cachedInputTokens` に正規化する。どちらも optional なので、報告しない
プロバイダでは 0 になるだけで落ちない。行き先は `routes/pdf.ts` の `onDone` が書く D1 の
`chat_messages.cached_input_tokens` で、**画面には出ない**（あとから費用を見るための列）。

出典は system prompt で `## Sources` セクションを書かせ、`parseCitations` が抽出する。
PDF 引用は `fullText` 内の位置からページ番号を割り出してジャンプ可能にしている。

ページ解決は `src/server/services/chatService.ts` の `findPageNumber` が行い、
`src/shared/schemas/book.ts` の `LocatedPage`（`{found: true, pageNumber}` か
`{found: false, miss}`）を返す。**見つからない理由を潰さないこと**——`miss` は
`no-quote`（引用文が空）/ `not-in-book`（本文に無い）/ `single-page-book`（1 ページの本）の
3 つで、読者に伝える内容がそれぞれ違う。とくに `not-in-book` は、**AI が引用を本文どおりに
書かなかった可能性**を読者が知る唯一の手がかりになる。消費者は 2 つ:

- `GET /pdf/:pdfId/locate` がそのまま返し、`useReadingLocation` の `passageMiss`
  （lookup 自体が失敗した `lookup-failed` を加えた 4 値）を経て `AppPage` の
  `PASSAGE_MISS_MESSAGE` が文言にする
- `parseCitations` が `pageMiss` として引用に載せ、`CitationBadge` の `PAGE_MISS_TITLE` が
  title にする。**引用は JSON で保存される**ため、`pageMiss` は discriminated union ではなく
  任意フィールドにしてある（この列が無い既存の行も読めるようにするため）

**チャットに載せる本文は全文ではなく抜粋**。抜粋の形は `DocumentExcerpt` で、本文のほかに
**`ranges: PageRange[]`**（その本文がどのページのものか）と `isPartial` を持つ。ここは
`src/server/services/documentExcerpt.ts` の純関数 2 本が作る。総ページ数の正はどちらも
fullText の `\f` 区切りで、D1 の `page_count` は見ない。

| 会話             | 切り出し                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| ハイライトの会話 | `selectExcerpt(fullText, 選択ページ, outline)`——章、無ければ ±10 ページの窓（`FALLBACK_WINDOW_PAGES`） |
| 本そのものの会話 | `selectRanges(fullText, 範囲の配列)`——読者が選んだ章のページ範囲を、クランプ・ソート・マージして切る   |

章のページ範囲を解くのは **`chapterSpans(outline, totalPages)` 1 箇所**
（`GET /api/pdf/:pdfId/chapters` がそのまま返し、`selectExcerpt` の `chapterBounds` もその
上の `find`）。読者が選ぶ範囲と抜粋が切られる範囲が食い違わないのはこのため。守るべき
不変条件が 3 つ:

- **抜粋は必ず fullText の逐語的などこか**（ページを `\f` のまま繋ぐ）。ページ範囲
  （pages X-Y of Z）は `--- DOCUMENT START ---` マーカーの**外**にだけ書く——中に何かを
  注入すると、モデルの引用が `findPageNumber` の全文照合で見つからなくなり、出典が全部
  `not-in-book` になる。**複数範囲でも区切りを増やさない**（`\f` のまま繋ぐ）
- **`selectRanges` は接する範囲をマージする**。2 章続けて選べば 1 本の連続した範囲になり、
  継ぎ目自体が消える
- **`parseCitations` / `findPageNumber` / `locate` は従来どおり全文で照合する**。抜粋で
  照合すると、ページ番号が抜粋内の相対位置（章の 2 ページ目 = 本の 6 ページ目）にずれる

飛び飛びの範囲では**継ぎ目をまたぐ引用**が本文に無い文になるが、フラグメント探索が最初の
実在断片のページに着地する（モデルが言い換えた引用と同じ扱い）。プロンプト側で
「part ごとに引用せよ」と指示している（`chatService.test.ts` の 1 本が挙動を固定）。
**どの範囲も本の外なら本全体に落ちる**（保存されたページ数と本文の `\f` が食い違う本で、
読めない 400 を返さないため）。

抜粋が本全体と一致するとき（1 ページの本・`\f` の無い旧データ・窓が覆う小さい本・
「本全体」を選んだとき）はプロンプトは従来の文言そのままで、「抜粋である」とは言わない。
部分のときだけ「shown pages に無いと言い、document 全体に無いとは言わない」旨をモデルに
指示する（`buildSystemPrompt`。`llmService.test.ts` が文言を固定している）。**複数範囲の
ときだけ**、`Instructions:` の直後に「part ごとに引用せよ」の 1 行が増える——この位置は
`MERMAID_RULE` より前で、文言を固定している 2 組の区間の外側。
**ハイライトの無い質問（本そのものへの質問）では `selectedText` が `null`** で、
`--- HIGHLIGHTED PASSAGE ---` のブロックごと出さない（無いハイライトを探させない）。

目次はクライアント（`pdfLoader` → `pdfOutline.ts` の `toStoredOutline`）がアップロード時に
トップレベル章だけを送り、再アップロードで他のメタデータと同様に**上書き**される（ただし
目次の無い抽出は保存済みの目次を消さない。上記「ストレージの分担」）。**既存の本（列が NULL）は窓で動くが、リーダーで開けば後追いで
章が入る**——表紙の後追い保存と同じ形で、`usePdfDocument` の `storeOutlineIfMissing` が、
開いているドキュメントから抽出した目次を `PUT /api/pdf/:pdfId/outline` に書く（本が目次を
持つかは `GET /api/pdf/:pdfId` の `hasOutline` が言う。アップロード直後のキャッシュ先充填も
この値を抽出結果から立てるので、足したばかりの本で二重に送らない）。目次の無い PDF は
何も書かず（サーバは空の目次を 400 で拒む）、窓のまま動き続ける。
**章の一覧が要るのは範囲メニューとサーバだけ**で、クライアントは
`src/front/hooks/useChapters.ts` が `GET /api/pdf/:pdfId/chapters` から読む（`chapterSpans`
と同じ目次が正なので、読者が選ぶ範囲と抜粋が食い違わない）。
選択ページは `selections.page_number` 列から読む（ビューアが計測結果ごと送ってきた
`pageNumber` は `positionData` の strip とは別に、この列として保存されている）。抜粋は
(fullText, outline, 選択ページ) または (fullText, 範囲) だけで決まる決定的な値なので、
同じ会話では system prompt のプレフィックスが安定し、DeepSeek の prompt cache は効き続ける
（範囲を変えると前置きが変わるので、そこだけ効かなくなる）。

全文を載せていた頃は 200 ページ級で最初のトークンまで 10 秒前後かかった。抜粋でも最初の
トークンまで数秒待つことはあるので、ストリーミングが壊れているのと区別すること
（`read()` が複数回に分かれるかで判別できる）。

#### 目次の無い PDF に AI で目次を作る

しおり（PDF の outline）を持たない本——スキャンした本や、書き出し時に落ちた本——には、
目次パネルの「この本には目次がありません」の下に**「AIで目次を作る」**が出る。押すと
`POST /api/pdf/:pdfId/outline/generate`（`routes/pdf.ts`）が LLM に章立てを尋ね、
**既存の目次と同じ形（`BookOutline`）で `pdfs.outline` に書く**。以後は PDF のしおりから
抽出した目次と区別しない——チャットの抜粋（`selectExcerpt`）も範囲メニュー
（`/chapters`）も同じ列を読む。

| 何を                                   | どこが                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| 送る中身・返答の検証と正規化（純関数） | `src/server/services/outlineGeneration.ts`（`buildOutlineMessages` / `readGeneratedOutline`） |
| LLM の呼び出し（非ストリーム）         | `llmService.ts` の `completeChat`                                                             |
| 受け口・409 / 502 の判定・保存         | `routes/pdf.ts` の `POST /pdf/:pdfId/outline/generate`                                        |
| 目次パネルへの表示とボタンの配線       | `src/front/hooks/useReaderOutline.ts` → `PdfOutline` の `generation`                          |

- **モデルに見せるのはページごとの先頭だけ**（`pageHeads`。`\f` で割ったページを空白を
  畳んで 1 行にし、`p.N: …` と番号を振る。既定 200 文字、全体で 60,000 文字に収まるよう
  長い本ほど 1 ページの取り分を減らす。下限 40 文字）。章は始まるページの頭に名乗るので
  それで足り、全文を送ると 1 冊で数十万トークンになる。空のページは行ごと落とすが番号は
  詰めない
- **プロンプトはチャットの `buildSystemPrompt` とは別物**（上記の区間の制約は関係しない）。
  JSON（`{"chapters":[{"title","page"}]}`）だけを返せと言うが、`response_format` は使わない
  ——OpenAI 互換の前提に含めない。代わりに**読み手が寛容**で、コードフェンスや前後の文に
  包まれた JSON・裸の配列も読む（`jsonIn`）
- **正規化**: タイトルを trim して空なら落とし、`MAX_OUTLINE_TITLE_LENGTH` で切る。ページは
  丸めて **1..`page_count` にクランプ**し、昇順に並べ、**同じページの 2 つ目以降は捨てる**
  （章は始まるページで切られるので、同じページの 2 章は 1 章に 2 つの名前があるだけ）。
  `MAX_OUTLINE_CHAPTERS` まで。何も残らなければ「目次ではない」扱い
- **失敗の言い分け**: キーが無い → 500 `CONFIG_ERROR`、本が無い → 404、**既に目次がある →
  409 `OUTLINE_EXISTS`（上書きしない。LLM も呼ばない）**、プロバイダが拒否・不通 → 502
  `AI_API_ERROR`、返答が目次として読めない → 502 `AI_RESPONSE_INVALID`。どの失敗でも
  何も保存しない。**SDK の自動再試行は切ってある**（`maxRetries: 0`）——ボタンを押した読者を
  3 回分待たせるより、失敗を言って押し直してもらう
- **画面側は PDF 自身のしおりが優先**（`useReaderOutline`）。しおりが空のときだけ、本が
  `hasOutline` を言っていれば `/chapters`（`useChapters`）を読んで `chaptersAsOutline`
  （`pdfOutline.ts`。先頭の無題区間を除いたトップレベルだけ）で目次パネルに出す。
  `hasOutline` が false なら尋ねずに「目次がありません」とボタンを出す。本がまだ届いて
  いなければ「読み込み中」のまま（ボタンを一瞬見せない）
- **生成が成功したら 2 つのキャッシュを動かす**——`chaptersKey` は再取得（区間を解くのは
  サーバ）、`bookKey` は `hasOutline: true` を書くだけ。これで目次パネルとチャットの範囲
  メニューが同時に章を持ち、`usePdfDocument` の後追い保存も空撃ちしない
- **EPUB には出さない**（`PdfViewer` だけが配線する。EPUB は自分の目次を持つ）

守っているのは worker の `test/worker/outlineGeneration.test.ts`（msw で `https://llm.test` の
chat completions を止める。保存・`/chapters` への反映・409・502 の 2 種・404・`CONFIG_ERROR`・
再試行しないこと）、jsdom の `outlineGeneration.test.ts`（送る中身と正規化）、
`useReaderOutline.test.tsx`（しおり優先・保存済みの章の表示・生成後の反映・失敗）、
`PdfOutline.test.tsx`（ボタン・生成中・失敗表示）、`pdfOutline.test.ts` の `chaptersAsOutline`。
**実際のモデルが良い章立てを返すかはどのテストも見ていない**（E2E は実キーが要るので無い）。
手で見るなら、メインクローンの `.dev.vars` の実キーで、しおりの無い PDF を開いて押す。

### 状態管理とルーティング

**画面に出しっぱなしにするサーバのデータは SWR、クライアントだけの状態は Jotai の atom**
（`src/front/atoms/`）。両方に同じものを載せないこと。

- `/` … 本棚（`ShelfPage`）。一覧は `useSWR("/api/pdfs")`
- `/books/:pdfId` … リーダー（`AppPage`）。本は `useBook(pdfId)` で読むので
  リロード・直リンクでも開ける。読んだ本は `PdfViewer` / `ChatArea` へ **props で**
  渡す（atom に写さない。読み手はこの 2 つだけなので prop drilling にならない）
- どちらのルートにも `errorElement` が付く（上記「失敗の運び方（neverthrow）」）

#### 本を足す口は本棚のグリッドにある

**追加はグリッド末尾のタイル（`ShelfPage.tsx` の `AddBookTile`）と本棚（`<main>`）への
ドロップの 2 つで、ヘッダーにボタンは無い**。本を足すことは本を並べることなので、本の隣に
置く。どちらの口も `ShelfPage` の `handleFile` に着地し、そこから `useOpenPdfBook`
（`src/front/hooks/useOpenPdfBook.ts`。抽出 → `POST /api/pdf/open` → キャッシュ先充填を
1 つの `ResultAsync` で運ぶ。先充填の中身と注意は下記「状態管理とルーティング」の SWR の
箇条）を通って `/books/:pdfId` へ出る。

- **ファイルを選ぶ口は隠した `<input type="file">` ただ 1 つ**。E2E は 3 spec とも
  `page.setInputFiles('input[type="file"]')` でこれを掴んでいるので、2 つ目を足すか
  別の方式（File System Access API 等）に替えると `openTestBook` ごと落ちる
- **タイルのアクセシブルネームは「本を追加」ちょうど**。「＋」は `aria-hidden` の
  `span`。Testing Library の `getByRole` は name を完全一致で見るので、ここに文字を
  足すと `ShelfPage.test.tsx` が落ちる。**Playwright の name は既定で部分一致**なので、
  E2E（`chatbook.spec.ts` の `app loads and shows the shelf` と `mobile.spec.ts` の
  `keeps the shelf shut until the password is typed`。2 つを一緒に拾う grep 文字列は
  無い）が落ちるのは「本を追加」が名前から消えたときだけ——jsdom の側が唯一の見張り
- **グリッドは一覧の結果によらず無条件に描く**（読み込み中も、読めなかったときも。
  `{(books ?? []).map(...)}`）。本を足すことは一覧を通らないので、エラーを返した本棚から
  入口を消さない。空状態の案内文はタイルだけのグリッドの上に併置する
- **ドロップの受け口は `<main>` 全体**（`<header>` は外なので、そこへ落とすとブラウザが
  ファイルを開く）。`dragenter` / `dragleave` は本のカードを通り過ぎるたびに飛んでくるので、
  深さのカウンタ（`dragDepth`）で数える——boolean だとグリッドの真ん中で合図が消える。
  **ドラッグ中に出す枠は `pointer-events-none`**（カーソルの下に現れると、それ自体が
  「離れた」ことになってカウンタが乱れる）
- **判定する主体は 2 つある**。ドラッグ中の合図は `carriesFiles`
  （`dataTransfer.types.includes("Files")`）が、落とされた中身は `pickDroppedBook` が
  決める。**`dragover` の `preventDefault` は `carriesFiles` のときだけ**——無いと
  ブラウザがファイルを開いて本棚から出ていく
- **落とされたものの判定は `src/front/lib/droppedBook.ts` の `pickDroppedBook`**（純関数。
  拒否の文言もここが持ち、`droppedBook.test.ts` が完全一致で照合する）。返すのは
  `book` / `refused` / `none` の 3 つで、**`none`（ファイルを運んでいないドラッグ。
  文字列の選択など）と `refused` は別物**——前者は読者の間違いではないので何も言わない。
  PDF か EPUB かは MIME 型で見て、型が空で届くファイルマネージャに備えて拡張子も見る
  （どちらの形式かを最終的に決めるのは抽出時のバイト列。下記「EPUB は章をページとして読む」）。
  1 冊だけ受け付けるのは、本棚が受け取った本へ出ていくため
- **処理中は全画面の覆いを出し、どこまで進んだかを言う**（`role="status"`）。
  `importing`（`ShelfPage` の state。タイルの `disabled`・ドラッグとドロップの無視・
  この覆いの 3 つが読む）は `reading` / `uploading` + 割合 / `storing` の 3 状態で、
  文言は `importWording` が作る——「本を読み取り中...」「アップロード中 45%」「保存中...」。
  （Dropbox の本は手前に `downloading`、テキストの無い PDF は `reading` と `uploading` の間に
  `recognizing`「文字を読み取り中 12/200 ページ」が入る。**「中止」ボタンが出るのは
  `recognizing` の間だけ**——数分かかりうるのはそこだけで、止まる口を持つのもそこだけ。
  上記「テキストの無い PDF（OCR）」）
  **`uploading` → `storing` は割合が 1 に達したことから `ShelfPage` が自分で決める**
  （送り終えたことを報せる合図は無い）。**ブラウザが本体の大きさを言わないときは割合が
  出ない**ので、その環境では覆いが直前の文言のまま送信が終わるのを待つ。
  **割合だけでは足りない**: 読み取りは何も送る前、`storing` は全部送り終えたあとの
  サーバの書き込みで、そこを 0% と 100% のまま見せると止まって見える。22MB の本は
  スマホからの送信だけで実測 76 秒かかるので、動いていることが分かる数字が要る
  （送信の割合を報せられるのは `XMLHttpRequest` だけ。下記「アップロードだけ
  `postWithProgress`」）。**成功したときに `importing` を戻さない**——遷移でこのページ
  ごと消え、ビューアの「PDFを読み込み中...」が続きを引き取る。戻すと本を開いている
  途中に本棚が 1 レンダー見える
- 失敗（読めない PDF・サーバの拒否・ドロップの拒否）は既存の `actionError` に合流し、
  本棚上部の赤帯に出る（上記「失敗の運び方（neverthrow）」の表）
- **幅では分けない**（グリッドの列数だけ `sm:` / `lg:` で刻む）。指の端末にドロップは
  無いので、そこではタイルが唯一の口になる

守っているテストは次のとおり:

| 何を                                             | どのテスト                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 落とされたものの判定と拒否の文言                 | `src/front/lib/droppedPdf.test.ts`                                                                                            |
| キャッシュ先充填と拒否の運び方                   | `src/front/hooks/useOpenPdfBook.test.tsx`                                                                                     |
| 進捗・拒否・切断の運び方（XHR 側）               | `src/front/lib/fetcher.test.ts`                                                                                               |
| タイルの位置・枠の出入り・処理中の覆い・拒否表示 | `src/front/pages/ShelfPage.test.tsx`                                                                                          |
| OCR の段階の覆いと中止                           | 同上（「counts the pages up…」「takes the cancel button away…」「stops reading a book by OCR…」「offers no way to cancel…」） |
| 実際に本が開くこと                               | `e2e/chatbook.spec.ts`「adding a PDF from the shelf opens the reader and renders its pages」                                  |

**E2E にドロップのテストは無い**（Playwright からファイルのドラッグを合成できない）。
ドロップの経路を守っているのは jsdom だけ。

#### 本棚の設定は ⚙ にまとめる

**一度決めたら触らないもの——優先する形式と Dropbox の参照フォルダ——は本棚ヘッダーの ⚙
（`ShelfSettingsMenu.tsx`。アクセシブルネーム「設定」、リーダーの `SettingsMenu` と同じ形）に
置く**。ヘッダーに直接並べるのは、本棚を眺めながら切り替えるもの（「非表示の本」「コンパクト表示」）
だけ。Dropbox の欄は Dropbox の資格情報があるデプロイにだけ出し、読めなかったフォルダでも
「Dropboxフォルダを設定」から直せる（押すとメニューを閉じて `DropboxFolderDialog` を開く）。
**新しい本棚の設定もここに足す**——狭い画面のヘッダーはもうボタンで埋まっている。
守っているのは `ShelfPage.test.tsx` の「keeps the setting in the shelf's settings menu…」と、
Dropbox のフォルダの設定・保存の 4 本（どれも ⚙ を開いてから操作する）。

#### 本棚は題名ごとに 1 項目、不要な本は非表示にできる

**同じ題名のファイルは 1 つの項目にまとまる**（PDF と EPUB、取り込み済みの本と Dropbox の
未読み込みファイルを区別しない）。計算は `src/front/lib/shelfGroups.ts` の純関数
（`groupShelf` / `splitHidden`）で、サーバには持たない。**同名の判定はファイル名から
`.pdf` / `.epub` を除き、Unicode を NFC にそろえ、大文字小文字を無視したもの**——Mac の
Dropbox が濃点を分解形で返すことがあるため（読者が題名を変えた本は変えた題名で比べる。
下記「題名は読者が変えられる」）。項目の中では**優先する形式が先、同じ形式の中では
取り込み済みが Dropbox の未読み込みより先**で、カードと題名は先頭のファイルを開き、2 つ以上
あるときだけ形式ごとのチップがそれぞれを開く。**1 つだけの項目も形式を言う**——題名の下の説明の先頭に押せないバッジ
（`FormatBadge`）を置く。チップが無いと、それが PDF か EPUB かを読者が知る手立てが無いため。**削除は項目の取り込み済みの本をすべて**消す（確認文が「PDF・EPUB」と言う）。

**優先する形式は読者が選ぶ**（本棚の ⚙「設定」メニュー——`ShelfSettingsMenu.tsx`——の
「優先する形式」の `<select>`。PDF / EPUB、既定は PDF）。本をまたぐ読者の好みなので `settingsAtom.ts` の `preferredFormatAtom`
（`chatbook:preferred-format`。`validatedStorage` で、形式でない値は PDF に落ちる）が
localStorage に持ち、`groupShelf` の第 3 引数に渡る。並びは `shelfGroups.ts` の `memberOrder`
が決め、**優先する形式は「取り込み済み」に勝つ**——EPUB を選んだ読者が PDF だけ取り込んで
いる題名を開くと、Dropbox から EPUB を取得して開く（取得は 1 度きりで、以後は取り込み済み）。
取り込み済みを先にすると、ちょうど別の形式が Dropbox に現れた題名でだけ設定が効かず、
選んでいない形式が開く。**この規則は既定（PDF）でも効く**ので、取り込み済みが EPUB だけで
PDF が Dropbox にある題名は、設定ができる前（EPUB が開いた）と違い PDF を取得して開く。
置き場所をヘッダーにしないのは検索欄と同じ理由（狭い画面のヘッダーはボタンで埋まっている）で、
狭い画面では検索欄の下に折り返す。**PDF / EPUB の 2 ボタンにしない**——チップの名前
（「… を PDF で開く」）が部分一致で当たる。表紙と進み具合は項目内の順に依らない
（`coverOf` は表紙のある最初の本、`groupProgress` は一番進んだ本）。

**題名は読者が変えられる**。`pdfs.title`（`migrations/0011_add_book_title.sql`。nullable）
に持ち、**`null` はファイル名から作る従来の題名**。画面に出す題名は
`src/front/lib/bookTitle.ts` の `bookTitle(book)`（`title ?? titleOf(fileName)`）1 箇所が
決める——本棚・リーダーのヘッダー・削除の確認文がこれを読む（リーダーのヘッダーは以前
拡張子付きのファイル名を出していたが、今は本棚と同じ題名）。

- **受け口は `PATCH /api/pdf/:pdfId`**（`{ title }`。`renameBookRequestSchema`）。前後の
  空白を除き、**空・空白だけ・`null` は `null`（元に戻す）**、200 文字
  （`MAX_BOOK_TITLE_LENGTH`。ダイアログの入力欄も `maxLength` で同じ値）を超えると 400、
  無い本は 404。応答は `{ id, title }`。**`updatedAt` は動かさない**（本棚の並びはそれで
  決まり、題名を変えることは本を開くことではない）
- **`GET /api/pdfs`・`GET /api/pdf/:pdfId`・`POST /api/pdf/open` の応答すべてに `title`
  が載る**。アップロードの応答に要るのは `useOpenPdfBook` のキャッシュ先充填のため——
  題名を変えた本を同じファイルからもう一度足したとき、リーダーにファイル名の題名が出ないように。
  **`storePdf` の上書きは `title` を列挙しない**ので、再アップロードで題名は消えない
- **口は本棚の項目の「✎」**（`aria-label` は「〈題名〉 の題名を変更」。「非表示」「削除」
  「開く」と部分一致で当たらない名前）。取り込み済みの本がある項目にだけ出す（Dropbox の
  未読み込みファイルの名前はファイルシステムのもの）。ダイアログは
  `src/front/components/BookTitleDialog.tsx`。**項目のすべての本に同じ題名を付ける**——
  1 つだけ変えると項目が 2 つに割れる（次項）。順に送り、最初の拒否で止める
- **同名でまとめる判定は変えた題名で行う**。読者に見えている名前はそれで、読者が同じ題名を
  付けた 2 冊は、ファイル名がどうであれ読者にとって 1 冊。**ただし、変える前の名前のままの
  ファイルは変えた本の項目についていく**（`groupShelf` の `renamedFrom`）——Dropbox の
  未読み込みファイルは読者のファイルシステムの名前で、題名の変更はそれに触れない。ついて
  いかせないと、PDF の題名を変えたとたんに同じ本の EPUB が古い名前で別の項目に出る。
  題名の付いていない本（後から Dropbox から取り込んだ EPUB など）も同じ扱い。項目の題名は
  読者が書いた題名が優先
- **成功したら 2 つのキャッシュを書き換える**（取り直さない）。本棚（`/api/pdfs`）と、
  リーダーが読む `bookKey(id)`（キャッシュに無ければ何もしない）。失敗はダイアログの中に
  出し、ダイアログは打った題名のまま開いている（下記の失敗の表）
- **マイグレーションは先に当てる**。`readPdf` / `storePdf` は `pdfs` の全列を読むので、未適用の
  D1 では本を開く経路と本の追加が 500 になり、本棚の一覧も `title` を select するので 500 になる。
  nullable な列の追加なので旧コードには無害

守っているのは `shelfGroups.test.ts`（優先する形式の並び・変えた題名でのまとめ方）、
`bookTitle.test.ts`、`ShelfPage.test.tsx` の「the preferred format」と
「renaming a book」、`AppPage.test.tsx`「heads the reader with the title…」、
`useOpenPdfBook.test.tsx`「keeps the title…」、`test/worker/pdf.test.ts` の
`PATCH /api/pdf/:pdfId`、desktop の E2E「a title given on the shelf is what the shelf and
the reader say after a reload」（fixture ではなく専用の本を使う——fixture の題名は他の
テストが名指しているので、失敗して題名が残ると全件を巻き込む）。

**非表示は `hidden_books`（`migrations/0009_add_hidden_books.sql`）にサーバで持つ**——
端末をまたいで同じ本棚にするため。キーは取り込み済みの本なら `pdfs.id`、未読み込みの
Dropbox ファイルなら Dropbox の id（`id:...`）で、外部キーは張らない（後者に行が無い）。
読み書きは `GET` / `PUT /api/shelf/hidden`（`routes/shelf.ts`。PUT は `{ keys, hidden }` を
受けて、**直後の全件を返す**）。項目の非表示はその項目の全ファイルのキーをまとめて送る。
**項目が非表示になるのは、中のファイルがすべて非表示のとき**——非表示の題名に新しい形式が
Dropbox から現れたら、読者がまだ判断していないファイルなので項目は本棚へ戻る。
一覧は本棚と別の SWR で、読めなくても本棚は描く（読めなかったことは赤帯に出す）。
戻す口はヘッダーの「非表示の本 (N)」から開く一覧の「表示に戻す」。

**マイグレーションは先に当てる**: 新しいテーブルを足すだけなので旧コードには無害だが、
新しいコードは `/api/shelf/hidden` が 500 になる。

**読書の進み具合は一覧（`GET /api/pdfs`）の `lastReadPage` から出す**——読書位置
（下記「読んでいた場所は本と一緒に運ぶ」）の `last_read_page` をそのまま載せたもので、
一覧の select に列を 1 つ足しただけ（`full_text` は相変わらず読まない）。計算は
`src/front/lib/readingProgress.ts` の純関数で、**`readingPercent` は切り捨て**——100% は
最終ページだけを指す（四捨五入だと 200 ページ中 199 ページ目が読了に見える）。保存位置が
本の外なら本の中へ丸める。**`null`（一度も開いていない）は 0% ではなく「未読」**で、カードは
表紙の左上に Kindle の NEW 相当のバッジを、行は同じ文言を出す。**項目の進捗は、項目内の
取り込み済みの本のうち一番進んだもの**（`groupProgress`）——読者が読むのは題名で、
スマホで EPUB・机で PDF と読み分けても進んだ方がその題名をどこまで読んだかだから。平均に
すると開く必要のなかった片方が読了を引き下げる。比べるのは割合（EPUB は章、PDF はページで
数えるため）。**Dropbox の未読み込みだけの項目は何も出さない**（「未読み込み」のまま）。
バーは `aria-hidden` で、ボタンの中では役割が読み上げに届かないので、割合の文字
（「12%読了」/「未読」）をボタンの `aria-describedby` が指す。

**本棚の検索はクライアントだけで絞る**（本棚の全項目は手元にある）。照合は
`shelfGroups.ts` の `filterShelf` で、**同名判定と同じく NFC・trim・小文字にそろえた
部分一致**を項目の題名（拡張子を除いたもの）に対して行う。打つたびに絞り、IME の変換中も
絞る（手元のフィルタなので途中の文字列で困らない。チャットの検索のように Enter を待たない）。
「非表示の本」の一覧も同じ語で絞る。0 件なら「「…」に一致する本はありません」を出し、
**「本を追加」のタイルは絞り込み中も残す**。検索欄はヘッダーではなくグリッドの上
（狭い画面のヘッダーはボタンで埋まっている）で、名前は「本棚を検索」——既存の部分一致の
ロケータ（「本を追加」「非表示の本」「コンパクト表示」「削除」）に当たらない。

#### 狭い画面のリーダーは 1 カラム

リーダーは幅で 2 つの姿を持つ。**境界の数値を持つのは `src/front/lib/viewport.ts` だけ**
（`NARROW_MAX_WIDTH = 767`px と、そこから作る `NARROW_QUERY`。Tailwind の `md` の 1px 下）。
`useIsNarrow`（上記「`useEffect` の扱い」）も `outlineOpenAtom` もここを読む。
**同名の `src/test/viewport.ts` は別物**で、そちらは jsdom 用の `matchMedia` スタブ
（下記「jsdom に無いものは `src/test/setup.ts` が埋める」）。

**要素の親子関係が変わる分岐は `useIsNarrow` の JS で行う**（パネルがオーバーレイになる、
ページ操作の行が別の場所へ移る、など）。CSS では親子関係を書けないため。**見た目だけが変わる
ところは `md:` 接頭辞でよい**——本棚（`ShelfPage.tsx` の削除ボタン）と、リーダーのヘッダ
（`AppPage.tsx` の `md:block` / `md:ml-4` / `md:flex-none md:max-w-xs`。狭い画面で「本棚」への
リンクが折り返さないようにするためのもの）がそれ。本棚のグリッドの列数は `md:` ではなく
`sm:` / `lg:` で刻む。

**分岐の軸は 3 つあり、問いで選ぶ。**「何が置けるか」なら幅（`useIsNarrow` か `md:`）、
「誰のための飾りか」なら端末の能力（CSS の hover メディアクエリ。下記の入力の表）、
「どう触れたか」なら入力イベント自身（`pointerType` など。同じ表）。**親指のためのコントロールを
足すときに幅で消してはいけない**——タブレットは広い画面に入るので `md:hidden` はそこから消す。
消したい相手が「hover できる読者」なら hover で問う。

| 広い画面（768px 以上）                                        | 狭い画面（767px 以下）                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 目次は横に並ぶ（`PdfOutline` の `w-60`）                      | 左からのドロワー + 背後を覆う暗幕（タップで閉じる）。目次から飛んだときも閉じる                     |
| PDF + チャットの 2 ペイン                                     | PDF 全幅の 1 カラム                                                                                 |
| チャットは右のパネル（`chatPanelOpenAtom`）                   | 下から出るシート `ChatSheet`（`src/front/components/ChatArea/ChatSheet.tsx`）                       |
| 目次とチャットの開閉はヘッダーの 2 つ（＋本文検索）           | `PageToolbar` の両端（目次・検索 / チャット）                                                       |
| ページ送りは hover できない端末だけページの下（スクロール内） | `PageToolbar`（`components/PdfViewer/PageToolbar.tsx`。描くのは `AppPage`）。hover は問わず必ず出る |
| マウスで選んだら浮遊ポップオーバー                            | 下端の `SelectionActionBar` →「AIに質問」で `SelectionPopover`（`floating={false}`）                |
| ペイン境界のドラッグハンドルで幅を変える                      | ハンドルは出さない（分ける相手がいない）                                                            |
| チャットを最大化するトグル（パネルが開いている間だけ）        | トグルは出さない。シートの「チャットを広げる」が受け持つ                                            |

**この表は「何が画面に出るか」だけを決める**（ページ送りの行だけは、広い画面側が幅と端末の
能力の両方で決まる。下記「ページ送りの行を出すかどうかは…」の段落）。
**「どう触れるか」は幅で分けない**——タブレットは
幅が広く指しかないので、幅で分けると全部マウス向けの経路に落ち、本文を選ぶことすらできなく
なる。ノート PC の画面に触ることもタブレットにマウスを挿すこともあるので、端末単位の判定も
同じく取りこぼす。**入力の分岐はイベント自身で行う**（`touchstart` はマウスでは発火しない、
`PointerEvent.pointerType` は 1 件ごとに `"mouse"` / `"touch"` / `"pen"` を報せる）。
ジェスチャの配線は `useIsNarrow` を読まない。

| 入力                           | どう分けるか                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ピンチ・スワイプ               | `touchstart` / `gesturestart` の購読だけ。指のときしか発火しない。スクロールで読むときはスワイプで送らない（指は列を動かす）                                          |
| 左右タップでのページ送り       | 分けない（マウスのクリックでも送る）。どちらの端が次かは本の向きで決まる（下記「ページめくりの向きは本ごとに持つ」）。スクロールで読むときは送らない                  |
| 中央のダブルタップでの拡大     | `pointerType !== "mouse"` のときだけ（マウスには Ctrl+ホイールがある）                                                                                                |
| 選択の確定                     | 分けない。常に `useSettledSelection`（`src/front/hooks/useSettledSelection.ts`。`selectionchange` が止まり、**かつ**ポインタが離れてから `SELECTION_SETTLE_MS` 待つ） |
| 選択したあとに何を出すか       | 指なら `SelectionActionBar`、マウスなら入力欄（狭い画面はマウスでもバー。320px の入力欄が収まらないため）                                                             |
| ペイン境界のハンドル           | 分けない。pointer イベント + `setPointerCapture` で、マウス・指・ペンの 3 種が同じ 1 本のコードを通る                                                                 |
| hover の有無で出し入れするもの | CSS の hover メディアクエリだけ。`src/` に 2 箇所——本棚の削除ボタン（`[@media(hover:none)]:opacity-100`）と広い画面のページ送り（`[@media(hover:hover)]:hidden`）     |

最後の行だけは入力ではなく端末の能力の話で、**JS の分岐ではなく CSS で問う**——見た目の出し入れ
しか変わらず、能力そのものを尋ねる語彙は CSS 側にしかないため。

**何で選んだかは `useSettledSelection` が確定の合図と一緒に渡す**（`pointerdown` の
`pointerType`。一度も来なければ `null`——沈黙をマウスと決めつけると iOS がマウス扱いになる）。
`PdfViewer` はそれを `chosenByFinger` に控え、`offerFirst`（＝ `isNarrow || chosenByFinger`）で
振り分ける。**押し下げの時点で控えるのが要**——長押しを platform が自分の選択に取り上げると
`pointercancel` で終わり、そのあとハンドルを動かしても pointer イベントは来ない。
**指に入力欄を先に出してはいけない**のは、開いた瞬間にフォーカスを取って選択を畳み、読者が
広げようとしていたハンドルごと消してしまうため。バーはフォーカスを取らないので、出たあとも
範囲を広げ続けられ、バーが見せる引用がそれに追従する。

**ページ送りの行を出すかどうかは、広い画面だけが端末の能力で決める。**形はどちらも同じ
`PageStepper`（前 / 現在地 / 次。`components/PdfViewer/PageStepper.tsx`）で、置き場所と判定が
違う。狭い画面は幅だけで決まり、`PageToolbar` が窓の下端に必ず出す。広い画面は `PdfViewer` が
ページの下（スクロール内）に置くが、**hover できる端末には出さない**（ラッパーの
`[@media(hover:hover)]:hidden`）——ページを送るのは端のクリックとキーボード（方向キーの
`←` / `→` はモードを問わず、vim モードなら `h` / `l`、emacs モードなら `C-f` / `C-b`）で足り、
1 ページずつ送って読む本で今が何ページ目かを
知っても使いようがない。**今どこを読んでいるかは消えていない**——目次は現在のページを含む項目を
強調し（`pdfOutline.ts` の `findActiveEntry` が選び、`aria-current="location"` で示す。見出しの文字列ではなく
エントリそのもので照合するので、章ごとに「はじめに」が並ぶ本でも点くのは 1 つ）、`?page=` はアドレスに残る。出ているときの表示は
出ている枚数に従い、見開きなら `11-12 / 12`、1 ページなら `12 / 12`（`step` prop。既定は 1 で、
狭い画面の `PageToolbar` は渡さない）。

**広い画面を幅ではなく端末の能力で分ける**のは、タブレットがそこに入るため（1024px は
`NARROW_MAX_WIDTH` の上）で、幅で消すとタブレットからページ送りが消える。この分け方の帰結は
2 つある——**hover を報せる端末はすべて出ない側に落ちる**（画面に触れるノート PC も、マウスを
挿したタブレットも。ポインタとキーボードがある前提で受け入れる）。そして**マウスの PC でも窓を
767px 以下に縮めればページ送りは出る**（あちらは電話のレイアウトそのもので、幅で選ぶ。1 カラムに
代わりの行は無い）。

**開閉のトグル（目次とチャット）はヘッダーに 2 つ並べる**（`AppPage`）——目次を畳むのと
チャットを畳むのは同じ種類の操作で、パネルの中に置くと戻る道を一緒に畳んでしまう。狭い画面に
この 2 つは出さず、`PageToolbar` の両端が兼ねる。**広い画面の開閉は本ごとにサーバへ残る**ので、
畳んだ本は次に開いても畳まれたまま（狭い画面は保存も復元もしない。下記「読んでいた場所は本と
一緒に運ぶ」）。

**回答だけを読みたいときはチャットを最大化する**（`chatMaximizedAtom`。
`src/front/atoms/chatAtom.ts`。書き手は最大化のトグルとチャットの開閉トグル、**読み手は
`AppPage` だけ**——PDF ペイン・ハンドル・チャットのペインの 3 箇所と、トグル自身のラベル）。
**これは広い画面だけの話**で、狭い画面で同じことをするのはシートを全高まで引き上げること
（下記「`chatSheetAtom`…」。あちらは別の atom で、ページを隠しもしない）。**幅で分けてよい**
のは、畳む相手の第 2 ペインが広い画面にしか無いから——上の 3 つの軸でいう「何が置けるか」に
当たる。

開閉の 2 つに並ぶトグル（「チャットを最大化」/「最大化を解除」）で、PDF ペインとハンドルを
inline の `visibility: hidden` にし、チャットのペインを `absolute inset-0` でその上に重ねる
（乗る土台は `main` の `relative`。シートと同じもの）。**ペインを外さず、幅も 0 にしない**
——外すと `useKeyboardShortcuts`（購読しているのは `PdfViewer` の中）ごと消え、幅 0 は
`PdfPage` を unmount するので戻ったときにページを描き直す。**チャットをフローの外へ出すから
左ペインの幅が動かず**、寸法が変わらなければ `PdfViewer` の ResizeObserver は何も聞かない。
`visibility` を選ぶ 3 つ目の理由は**アクセシビリティツリーからも外れること**で、覆うだけの
実装（z-index）に替えると、隠れたページに Tab で入れてしまう。代償は**見えないままでも
`←` / `→` がページを送ること**（入力欄にフォーカスが無いとき）で、キーボードが生きている
ことの裏面として受け入れている。**チャットのペインは同じ要素のまま**にする（2 つに分けると
`ChatArea` が作り直され、開いている会話・検索語・打ちかけの質問が消える）。

**最大化はどこにも保存しない**——1 つの回答を読み通すためのもので、本の畳み方ではない。
リロードでも別の本でも最大化は付いてこない（store は本ごとに作り直される。下記「状態管理と
ルーティング」の「リーダーの state は本ごとに作り直す」）。**開閉はその本の保存値どおり**
なので、次の本が 2 ペインで開くとは限らない。そして**チャットの開閉トグルはどちら向きでも
最大化を解除する**——あれはページを出せという指示なので、残すと「チャットを表示」が読者の
出したページをまた隠すことになる。トグル自体もパネルが開いている間だけ出す。

守っているのは jsdom の `AppPage.test.tsx` 4 本（「puts the page out of sight…」
「takes the maximize toggle away with the chat…」、本を替えても付いてこないことを見る
「opens the next book on its page…」、狭い画面に出ないことを見る「offers no maximize
toggle…」）と、desktop の `e2e/chatbook.spec.ts`「gives the chat the window on the maximize
toggle…」。**E2E が見るのは、解除したページが同じ幅で描かれていること**（完全一致）で、
描き直しそのものは見ていない——同じ幅で描き直されれば素通りする。

**ページの大きさはペインが決める**（`src/front/lib/pageScale.ts` の `fitPageScale` が
`min(幅で合わせる倍率, 高さで合わせる倍率)`、読者の倍率はその上に乗る）。**ページ全体が必ず
見えることが約束**で、幅を優先すると足が画面の外に出るため崩してはいけない
（`e2e/chatbook.spec.ts` の「the whole page is visible…」と「dragging the splitter…」が守る）。

#### 幅が余ったら 2 ページ並べる

ペインに 2 ページ分の幅があれば見開きで出す。**判定はペインの実測と読者の倍率だけで、パネルの
開閉は見ない**（`src/front/lib/spread.ts` の `fitsTwoPages`。ペインの内寸は `PdfViewer` の
ResizeObserver がすでに測っていて、目次・チャットの開閉にもスプリッターにも追従する）。
横長のモニタなら目次を出したままでも 2 ページになり、電話ではどれだけ畳んでも 1 ページのまま
——「何が置けるか」は幅の話なので、上記の分岐の軸のうち幅で決まる側に入る。ただし
`useIsNarrow` の 767px ではなく**ページが 2 枚入るかという実測**で分ける。

**条件は「1 ページのときの表示サイズのまま 2 枚並ぶこと」**（`fitPageScale` で合わせたページ幅
× 読者の倍率を実効幅と呼ぶと、実効幅 × 2 + `SPREAD_GAP_PX` = 8px ≤ ペイン幅）。2 枚目は
1 枚目を縮めてまで出す価値がないので、少し足りないときは 1 ページのままにする。**判定が引くこの
8px と、実際に描かれる隙間（`PdfViewer.tsx` の flex の `gap-2`）は別物**——一致を確かめている
ものは無いので片方だけ動かさないこと。隙間が要るのは、ページごとの `shadow-lg` が接合部で
溶け合って 1 枚の紙に見えてしまうため。

**倍率が条件に入るのは、それが読者の描いているページの大きさそのものだから**。縮めれば入らな
かったペインに 2 枚目が入り、拡げればその場所を返す（拡大した 1 枚が読者の見たいものなので、
両方を縮め直すのではなく 2 枚目が退く）。**電話が見開きにならないことはこれで変わらない**——
ページの縦横比より細いペインは幅で律速されるので、条件は `MIN_ZOOM`（`src/front/lib/pageScale.ts`
が持つ 0.5 倍）より小さい倍率を要求することになり、どれだけ縮めても成立しない。

**ページのフィット先はペイン全幅**（`PdfPage` の `containerWidth`。見開きでも半分にしない）。
上の条件から、現在ページは自分の半分に必ず収まる。**半分に合わせ直すのが目に見えて壊すのは、
倍率を下げて成立した見開きだけ**——倍率 1 の見開きは条件（実効幅 2 枚 + 8px ≤ ペイン幅）から
半分幅 ≥ ページ幅が従い、必ず高さ律速なので半分に合わせても同じ大きさに描かれる。縮めて
成立した見開きでは半分が幅律速に変わり、両方が読者の倍率より小さくなる。**これを守っているのは
E2E の 1 つのアサーションだけ**——縮小側のテストが「左ページ幅 ÷ 縮小前のフィット幅」を見て、
1 回のピンチインが着く `MIN_ZOOM` どおり 0.5 になることを確かめる。半分に合わせると
1280×720（両パネルを開いた状態）でこの比が 0.28 に落ちる。

**その代わり、相方は半分に収まる保証を持たない**。判定は現在ページの寸法しか見ないので、
縦横比の違うページ——横長の図版ページ——が相方に来ると、そちらは自分の寸法でペイン全幅に
フィットして半分を超え、ペインからはみ出す。**半ペインに合わせていた頃は起こらなかった退行**で、
寸法の揃った本（E2E の fixture は全ページ A4 なので検出しない）では上位の「ページ全体が必ず
見える」約束は破れないが、混在する本でだけ破れうる。フィット先を全幅にした代償としてそこは
許容している。

**倍率は本ごとに localStorage に残る**（`zoomAtomFor(pdfId)` = `chatbook:zoom:<pdfId>`。下記
「状態管理とルーティング」）ので、縮めたまま閉じた本は次に開いても見開きで始まる。**電話が
見開きにならない保証は、倍率の書き手が全員 `MIN_ZOOM` で丸めることに乗っている**——ホイールの
`nextZoom`、指と Safari の `pinchZoom`、ダブルタップのリテラル、そして localStorage を読み戻す
`settingsAtom.ts` の validator の 4 つ。倍率の書き手を足すときはここを通すこと。

**現在ページが常に先に読む側**（`visiblePages`。左開きの本なら左、右開きの本なら右）。
引用リンクやハイライトで p.7 へ飛べば [7|8]（右開きなら [8|7]）になり、名指されたページが
必ず読み始めの側に来る。最終ページに相方が無ければ 1 枚だけ描く。`visiblePages` が返すのは
**画面の左から右の順**なので、右開きでは番号が降順に並ぶ。`PageStepper` の「7-8 / 12」は
画面の順ではなく本の数え方で書く。

**ページ送りは出ている枚数だけ動く**（`turnTo`。端のクリック・スワイプ・`←` / `→`・`h` / `l`・
`PageStepper` が全部ここを通る唯一の算術）。**送り先が本の終わりを越えるなら動かない**——
12 ページの本の [11|12] からの送りは 13 ページ目を指すので、そこが本の終わり。**ただし余った
1 ページは「終わり」ではない**——[10|11]（リンクや目次で飛ぶと起こる）からの送りは 12 ページ目に
着き、読者がまだ見ていないその 1 枚を単独で出す。ここを見開き単位で止めると、最後の 1 ページが
どの操作からも届かなくなる。`G`（最終ページ）は最後の見開きの読み始めの側（`lastSpreadStart`）へ着地する。

#### ページめくりの向きは本ごとに持つ

縦書きの日本語の本や漫画は右から左へ読む（右開き）。**向きは本ごとの値**で、D1 の
`pdfs.page_direction`（`'ltr'` / `'rtl'`、既定 `'ltr'`。`migrations/0012_add_page_direction.sql`）
に置き、`GET /api/pdf/:pdfId` と `POST /api/pdf/open` の応答の `pageDirection` に載る。変えるのは
`PUT /api/pdf/:pdfId/page-direction`（`{ pageDirection }`。`updatedAt` は動かさない。本棚の並びが
変わるので）。PDF は自分の向きを言わないので、ファイルから推測はしない。

**変わるのは画面の左右と前後の対応だけ**で、**「次のページ」が何ページかは変わらない**
（`turnTo` は向きを知らない）。左右→前後の写像は `src/front/lib/touchNavigation.ts` の
**`turnToward(side, direction)` 1 箇所**で、次を全部ここに通す:

| 入力                        | 右開きでは                                                     | 純関数                                            |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| 端のタップ・クリック        | 左端が次、右端が前                                             | `resolveTapZone(x, direction)`                    |
| スワイプ                    | 指を右へ動かすと次（紙と同じく、左にある次のページを引き込む） | `resolveSwipe(swipe, direction)`                  |
| `←` / `→`・vim の `h` / `l` | `←` / `h` が次                                                 | `resolveAction(mode, stroke, pending, direction)` |
| emacs の `C-f` / `C-b`      | **変えない**（forward / back は画面の左右を指さない）          | 同上                                              |
| 見開きの並び                | 現在ページが右、次のページが左                                 | `visiblePages(…, direction)`                      |
| `PageStepper` の前後ボタン  | 左のシェブロンが「次のページ」（aria-label は前後のまま）      | `turnToward` を直接                               |
| 設定メニューのキー一覧      | 「←/→ 次 / 前のページ」「h 次のページ」                        | `keybindingHelp(mode, direction)`                 |

- **向きは props で配る**（`book.pageDirection` → `PdfViewer` / `PageToolbar` / `PageStepper`）。
  SWR の本が正で、atom に写さない（上記「`useEffect` の扱い」の「写し」）。キーボードは
  `useKeyboardShortcuts(onAction, direction)`、スワイプは購読の外にある `directionRef` で読む
- **変える口はリーダーの ⚙（`SettingsMenu`）の「ページめくり」**（左開き / 右開き）。値は本の
  ものなので、メニューは `pdfId` を受け取ったときだけこの欄を出す。保存は `usePageDirection`
  （`resultFetcher`）で、**サーバが受け取ってから** `bookKey` のキャッシュに書く（楽観的に
  書かない。拒否されたらページが読者の目の前で逆に戻ることになる）
- **形式を問わず選べる**。EPUB の画面めくりも同じ純関数（`turnToward` / `resolveTapZone` /
  `resolveSwipe`）に `book.pageDirection` を渡して従う（上記「EPUB は章をページとして読む」の
  めくりの向きの箇条）。EPUB で変わるのは入力の左右だけで、画面の並びは左から右のまま
- **向きは読書位置（`readingState`）ではない**。端末ごとの値でも開閉でもなく本の性質なので、
  `PUT /reading-state` とは別の口で、`useReadingStateSync` は触らない

守っているのは jsdom の `touchNavigation.test.ts` / `spread.test.ts` / `keybindings.test.ts`
（写像そのもの）、`PageStepper.test.tsx`（ボタンの並び）、`useKeyboardShortcuts.test.tsx` と
`PdfViewer.test.tsx` の「turns on with ← in a book that opens on the right」（配線）、
`usePageDirection.test.tsx` と `SettingsMenu.test.tsx`（保存と失敗表示）、worker の
`PUT /api/pdf/:pdfId/page-direction`。画面に出る結果は E2E の 3 本——desktop の
「a book turned to open on the right goes on from its left edge…」（端クリックとリロード後）と
「lays a spread of a book that opens on the right out from the right…」（見開きの並びと `←`）、
tablet の「turns a book that opens on the right on from the left…」（タップ・スワイプ・
ステッパー）。`pnpm run test:e2e -g "open on the right|opens on the right"` で 3 本まとめて走る。
**3 spec の `openTestBook` は向きも左開きに戻す**（同じ本を共有するため）。

**判定に要るページの素の寸法は `usePageBaseSize` が取る**（`getViewport({scale: 1})`）。
描かれた大きさから逆算できないのは、描かれた大きさこそがこの判定の結果だから。

**判定の算術そのものは `src/front/lib/spread.test.ts` が持つ**（ペインの寸法 × 倍率の組み合わせ）。
**電話が `MIN_ZOOM` まで縮めても見開きにならないことを守っているのはここだけ**——E2E は 7 本とも
desktop なので、あの主張を通る実行が無い。

画面に出る結果は desktop の E2E 7 本が守る（`e2e/chatbook.spec.ts` の
「puts a second page up once the pane has room…」「puts a second page up once the reader
shrinks…」「takes the second page back when the reader zooms in…」
「turns both pages of a spread…」「marks a passage taken from the right page…」
「keeps a drag made right to left…」「keeps a drag that runs on to the next page…」）。
7 本に共通の grep 文字列は無いので、見開きに触ったら `--project=desktop` を全件走らせる。
`PageStepper` の見開き表示と送り先は jsdom（`PageStepper.test.tsx`）が持つ——広い画面のあの行は
hover できない端末にしか出ないので、desktop の E2E からは触れない。
**desktop が見開きになるのは、チャットを畳んだときと読者がページを縮めたとき**なので、
`canvas.block` を数える・測るヘルパー（`settledCanvasWidth` / `drawnPageAndPane`、2 枚まとめて
ペインと突き合わせる `pagesAgainstPane` ほか）は `.first()` で左ページを見る。

**ペインの余白は上下だけ**（`PdfViewer.tsx` の `py-4`。左右は 0）。ページは横より縦が長いので、
その比より細いペイン——目次とチャットを開いた MacBook 14 がそれ——では幅が先に尽きて高さが余り、
**左右に置いた余白はそのぶんページの高さを削る**。読むことはページ単位のスクロールなので、
余った高さは読者が取り戻せない。実測では 1512×982 でページが 613×870 → 636×902 になり、
ページ下の空きが 48px → 16px（上下の余白）に減った。高さが先に尽きる幅（1280×720 /
1920×1080 / 2560×1440 で計測）では元から余りが無いので変わらない。
`e2e/chatbook.spec.ts` の「spends the pane's height on the page…」がこの幅を名指して守る。
**ページ下の `mb-4`（`PdfPage.tsx`）は残す**——ページの大きさには効かず（倍率はペインの箱から
決まる）、ページが収まっているときにペインが持つ唯一のスクロール余地なので、消すと `j` / `k` が
何も動かせなくなる。

ページ送りとズームの判定のうち、**帯・スワイプ・倍率の純粋な計算は
`src/front/lib/touchNavigation.ts`**（`resolveTapZone` / `resolveSwipe` / `pinchZoom`）が持つ。
**閾値は `PdfViewer.tsx` 側**にあり（`TAP_SLOP_PX` = 12px / `TAP_MAX_MS` = 500ms /
`DOUBLE_TAP_MS` = 320ms / `DOUBLE_TAP_ZOOM` = 2 倍 / `ENLARGED_ABOVE` = 1.05 倍）、
`PdfViewer` が両者を配線する。

**送ってよいかは `pointerdown` の時点で決める**（押した瞬間に `turnable()` を控える。
`turnable()` は「ポップオーバーが出ていない」かつ「選択が畳まれている」を見る）。
ポップオーバーを閉じるのはその外側を押すことで、閉じる処理は `mousedown` で先に走る。
`pointerup` で見ると何も出ていないように見え、読者が戻ろうとしただけのページが送られる。
**2 回目以降のクリック（`event.detail > 1`）も送らない**——単語をダブルクリックで選ぶ操作の
1 打目にあたるため。**拡大中（`ENLARGED_ABOVE` 超）はタップもスワイプも送らない**——
そのときの端は、ページを離れる操作ではなくページの中を動く操作。

広い画面にだけ出る**ペイン境界のハンドルは、当たり判定 44px・見た目の線は細いまま**
（`AppPage.tsx`。中の `span` が線）。`touch-action: none` が要る——無いと指のドラッグが最初の
move より前にスクロールへ吸われる。**44 は `HANDLE_WIDTH` 1 箇所だけが持つ**（`AppPage.tsx`。
親指が届く最小の寸法から採った値）。ハンドル自身の幅と、両ペインが `calc(…% - HANDLE_WIDTH / 2)`
で譲る量の両方がここを読む。譲らないと 3 つの合計がウィンドウを超え、flex が誰も勘定して
いない量だけペインを縮める。

**`chatSheetAtom`（`src/front/atoms/chatAtom.ts`。`closed` / `half`＝ペインの 46% /
`full`＝ペインいっぱい。どちらも `main` の中の `absolute` なので、基準は画面ではなくペイン）
はどこにも保存しない。** `chatPanelOpenAtom` は「広い画面でパネルを畳んだか」で、本と一緒に
サーバへ運ぶ（下記「読んでいた場所は本と一緒に運ぶ」）。シートは毎回 `closed` から始まる
——電話には畳んで残す第 2 のペインが無く、half と full は場所ではなくジェスチャだから。
**full がペインいっぱいなのは、広い画面の最大化にあたるのがこれだから**——上に残した数十 px
のページは読めるものではなく、そのぶん回答の行数が減る。**ただし作りは別物**で、
`chatMaximizedAtom` を使わず、ページを隠しもしない（シートが覆うだけ）。ペインはツールバーの
上で終わるので、全高でもページ送りとシートを縮める操作は残る（`e2e/mobile.spec.ts` の
「gives the answer the whole pane once the sheet is drawn all the way up」が両方を見る）。

**シートを開く口は 4 つ**——`PageToolbar` のチャットボタン、`AppPage` の `openChat`
（ページ上のハイライトのタップ・一覧・URL の `?selection=` 復元がすべてここを通る。
つまり `?selection=` 付きのリンクは狭い画面でもシートを `half` で開く）、**本について質問する**
（`openBookChat`。入口がシートの中にあるので、押した時点で既に開いている——シートを上げる
のは復元経路だけ）、そして**新しい質問の保存が成功したとき**（`useAskAboutSelection`）。
half と full の切り替えと閉じるのは `ChatSheet` 自身の `onChange`、読み手は `AppPage` だけ。

**狭い画面でも本そのものの会話を持つ**——`bookChatOpenAtom` はここでも保存・復元され
（`useReadingStateSync` が送る `place` に載る）、復元はページを変えずにシートを `half` まで
上げる。広い画面との違いは置き場所だけ（あちらはペイン、こちらはシート）。範囲メニューは
**シート半分でも最後の章まで届く**ことを `e2e/mobile.spec.ts` の
「asks the book itself from the sheet…」がシートの箱と突き合わせて見ている。

**質問することはチャットを開くことでもある。**質問を保存できたら、狭い画面ではシートを
`closed → half`（既に上がっているシートは動かさない。`openChat` と同じ意味論）、広い画面では
畳まれた `chatPanelOpenAtom` を開く（`useAskAboutSelection` が `useIsNarrow` で振り分ける）。
ここを開かないと、回答が畳まれた入れ物へ流れ込んで読者から見えない——狭い画面はシートの
既定が `closed` なので必ず起きる。保存に失敗したときは開かない（見せる回答が無く、
ポップオーバーがその場で理由を出す）。`openChat` は再利用しない——あちらは履歴を取得して
`chatMessagesAtom` を上書きするので、始まったばかりのストリームと衝突する。

シートの作りで外してはいけない点が 3 つある。**開閉は `translateY` ではなく高さ**で行う
（`ChatSheet.tsx`。押し下げる方式だと half のとき入力欄が画面外に出る）。**シートは `main` の
中に置き、ツールバーの上で止める**（`AppPage.tsx`。読み進めることが本と回答を同時に出す
理由なので、開いていてもページ送りが残る。`PageToolbar` は `position: fixed` ではなく
`h-dvh` の flex 列で `main` の下に並ぶ兄弟）。**リーダーのシェルは `overflow-clip`**
（`AppPage.tsx`。画面外へ逃がしたシートがスクロール領域を作り、入力欄のフォーカスで
リーダーごとずれる）。

**両方の atom は閉で始まる**（`outlineOpenAtom` は `src/front/atoms/pdfAtom.ts`、
`chatPanelOpenAtom` は `src/front/atoms/chatAtom.ts`。どちらも `atom<boolean>(false)`）。
**開くのは本が届いたときだけ**で、`useReadingLocation` が保存値を——本が何も言っていなければ
広い画面の既定である「開」を——当てる（下記「読んでいた場所は本と一緒に運ぶ」）。

**開で始めてはいけない**。リーダーの画面は本より先に描かれるので、開いた状態で始めると
パネルが取得のあいだ出てしまい、読者の目の前で引っ込む。**畳んで閉じた本ほど目立つ**——
前回畳んだ選択が毎回一瞬だけ取り消されて見える。逆向き（閉→開）のちらつきは残るが、
出るのは本が何も言っていないときだけで、増える方向なので読者の選択を否定しない。

**幅は初期値に関与しない**。広い画面かどうかは復元する側（`useReadingLocation`）が本の到着時に
1 度だけ見て、狭い画面ではどちらも当てない。あちらの目次はページを覆うドロワー、チャットは
`ChatSheet` と `chatSheetAtom` という別物なので、閉のままでよい。

目次の書き手は `PageToolbar` の目次ボタン・キーボードショートカット・暗幕のタップ・
目次から飛んだとき（狭い画面のみ）・広い画面のトグル・上記の復元。

見た目の原型は `docs/mockups/mobile.html`（依存ゼロの単一 HTML）。**正は実装**で、
モックは操作感を詰めるために作った参考物。テストの書き方は下記「jsdom に無いものは
`src/test/setup.ts` が埋める」の `setViewportWidth` を使う。

#### スクロールで読む（Kindle の「連続スクロール」）

ページめくり（既定）のほかに、**縦スクロールで読み進める**読み方を選べる。値は
`settingsAtom.ts` の `readingModeAtom`（`"paged"` / `"scroll"`、`chatbook:reading-mode`）で、
**本ごとではなく読者の好み**として本をまたいで残す（電話でスクロールして読む人は何を開いても
そう読む。本ごとにすると開くたびに探し直す設定になる）。選ぶ口は PDF がリーダーの ⚙
（`SettingsMenu` の `readingModeOffered`。`AppPage` が EPUB 以外で立てる）、EPUB が「Aa」
（`EpubTypographyMenu` の先頭）。どちらもラベルは `READING_MODE_LABELS`。

**PDF**（`PdfViewer`。算術は `src/front/lib/scrollLayout.ts` の純関数）:

- **全ページを 1 列に積む**（`stackPages`）。幅はペイン幅 × 読者の倍率（`PdfPage` に
  `containerHeight = Infinity` を渡すと `fitPageScale` が幅だけで決まる）。**見開きにしない**、
  **ズームは幅に対する倍率**。高さは描いたページは描いた縦横比、まだのページは現在ページの
  縦横比（無ければ A4）で見積もる
- **描くのは見えているページと前後 1 枚だけ**（`pagesToDraw`。`SCROLL_OVERSCAN`）。そのさらに
  外側 6 枚は寸法だけの白い紙（`SCROLL_SHEETS`）、残りは何も置かない高さだけの箱。数百ページの
  本でも描く量は変わらない。各ページは `absolute` の枠に入り、**ページ要素は今までどおり
  `data-page-container`**——選択・ハイライト・印はページ要素基準のまま動く
- **現在ページはスクロールから決まる**（`readingPage`。ビューの上から 1/4 の読書線の下にある
  ページ。最下部まで来たら見えている最後のページ——短い最終ページに読書線が届かないため）。
  `currentPageAtom` に書くので `?page=` と読書位置の保存（`useReadingStateSync`）がそのまま
  追従する
- **外から来たページ（キー・目次・引用・検索・URL・復元・ステッパー）へはスクロールする**。
  見分けは `reportedPageRef`（スクロールが最後に報告したページ）と違うかどうか。ビューの位置は
  `scrollAnchorRef`（上端のページと、その中の割合。`anchorAt` / `scrollTopOf`）で持ち、ページが
  描かれて高さが変わる・ペインの幅が変わる・ズームのたびに `useLayoutEffect` で当て直す
- 引用の印の「読み進めたら消す」は、描いているページの外へ出たとき。ページ送りのステッパー行
  （hover できない端末）はスクロールでは出さない

**EPUB**（`EpubViewer`）:

- **章を段組みせず 1 列で流す**（`.epubScrolled`。幅は 1 画面と同じ `scrolledLayout`、見開きに
  しない）。スクロールするのは紙（`<article>`）自身で、ページ要素は `translateX` しない
- **章の先頭に「前の章に戻る」、末尾に「次の章を読む」**。次の章は下に連結しない——章を
  またいで 2 つ描くと、ページ要素とハイライトの計測を章ごとに分ける仕掛けが要るため。
  キーの「次 / 前のページ」はビュー 9 割ぶん動かし、章の末尾 / 先頭では隣の章へ（前の章は
  `screen: "last"` で末尾に着地）。`j` / `k` は 80px。下部のシェブロンは章単位
  （`turnEpubChapterAtom`。ラベルは「次の章へ」「前の章へ」）
- **読んでいる位置はビューの先頭の行の文字位置**（`epubTextRange.ts` の `textOffsetAtY`。
  行の間の空白は描かれないので、その次に描かれた文字に寄せる——寄せないと節の見出しの直前の
  改行に止まり、その節が「まだ」になる）。スクロールのたびに取り直し、% と目次の強調が
  追従する。**自分で動かしたスクロール**（節・引用・章の切り替え）の scroll イベントは
  `ownScrollRef` で 1 回見送る——アンカーやパッセージの位置をビュー先頭の行で上書きしないため
- 幅・書体・画像で組み直したら、その文字位置へスクロールし直す（`yOfTextOffset`）。ページめくり
  と行き来しても `Placed.scrolled` で「組み直し」として扱うので、読んでいた語に留まる
- 節・リンクはその要素がビューの上端に、引用・ハイライトはビューの 1/4 下に来るようにスクロール
  する（`showPassage` の `atTop`）

**どちらも端のタップとスワイプでめくらない**（入力の表）。中央のダブルタップでの拡大（PDF）と
ピンチは残る。

守っているのは jsdom の `scrollLayout.test.ts`（積み方・読書線・アンカー・描く範囲）、
`epubTextRange.test.ts`「textOffsetAtY / yOfTextOffset」、`epubPaging.test.ts`
（`scrolledLayout` / `turnChapter`）、`EpubViewer.test.tsx`「read by scrolling」、
`EpubPageStepper.test.tsx`、`SettingsMenu.test.tsx` / `EpubTypographyMenu.test.tsx`（選ぶ口）と、
E2E 3 本——desktop の「reads a PDF by scrolling…」（`?page=` の追従・描くページの数・端の
クリック・キー・見開きにしない・リロード）と「an EPUB read by scrolling…」（章の末尾から次の章・
目次の節・スクロールで節の強調が動く）、mobile の「reads a PDF by scrolling on a phone…」。
`pnpm run test:e2e -g "by scrolling"` で 3 本まとめて走る。**PdfViewer の配線は jsdom では
見ていない**（pdf.js が無い）。E2E が選ぶ箱は `data-reading-mode="scroll"`。

#### ハイライトは質問しなくても作れる（色とメモ）

Kindle と同じく、**本文を選んで色を付けるだけ・メモを付けるだけ**でハイライトになる。
チャットは開かない（質問が無いので見せる回答が無く、シートを上げればマークしている
ページを覆う）。色は 4 つで、**値の正は `src/shared/schemas/selection.ts` の
`HIGHLIGHT_COLORS`**（黄 `#FFEB3B` / 青 `#42A5F5` / ピンク `#EC407A` / オレンジ `#FF9800`）、
読者に見せる名前は `src/front/lib/highlightColors.ts`、ボタンの列は
`src/front/components/ColorSwatches.tsx`（44px 角。提示バー・質問ボックス・編集欄の 3 箇所で共用）。

| 何を                                   | どこが                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| 保存の形（色の許可リスト・メモの上限） | `src/shared/schemas/selection.ts`（`highlightColorSchema` / `MAX_NOTE_LENGTH` = 2000）    |
| 作成（色とメモは任意）                 | `POST /api/pdf/:pdfId/selections`（`routes/pdf.ts`）                                      |
| 変更                                   | `PATCH /api/pdf/:pdfId/selections/:selId` → `pdfService.ts` の `updateSelection`          |
| マウスの選択に出すもの                 | `SelectionPopover`（色の列と「メモを書く」が入力欄の上に並ぶ）                            |
| 指・狭い画面の選択に出すもの           | `SelectionActionBar`（2 段目に色の列と「メモ」「AIに質問」）                              |
| 保存してキャッシュに足す               | `useAskAboutSelection` の `markSelection`（`askAboutSelection` と同じ保存の口）           |
| 後から変える                           | `HighlightEditor`（一覧の行の「…のメモと色を変える」と、会話の見出しの「メモと色」）      |
| キャッシュへの反映                     | `useHighlights` の `updateHighlight`（本のキー `bookKey` を書き換える。専用 atom は無い） |

- **色は保存された値が正**。`selections.color` は NOT NULL で既定が `#FFEB3B` なので、色を
  選べなかった頃の行はすべて黄で、それがそのまま意味になる（`HIGHLIGHT_COLORS` の先頭を黄に
  しているのはこのため）。質問から作るハイライトも色を送らないので黄。**配列の位置で色を
  補うのはやめた**——位置で決めると、前の行を消すたびに後ろの色がずれる。空の色が来たら
  （サーバは返さない。手で書いたキャッシュだけ）既定の黄で描く（`useHighlights` の `drawnColor`）
- **色は許可リストで検証する**（任意の `#RRGGBB` ではない）。画面に無い色を受け入れると、
  一度変えたら二度と選び直せない色が残る。外れれば 400（`Invalid request body: color`）
- **メモは前後の空白を落とし、空ならメモ無し（`null`）として保存する**（`noteInputSchema`）。
  編集欄でメモを空にして保存するのがメモの消し方で、別の「消す」ボタンは無い。上限を超えたら
  切り詰めずに 400（入力欄も `maxLength` で止める）
- **`PATCH` は `{ color?, note? }` の省略したほうを保つ**。どちらも無ければ 400。**別の本の
  ハイライトを名指したら 404（`SELECTION_NOT_FOUND`）**——`pdf_id` も条件に入れて更新する。
  応答は変更後の `{ id, color, note }` だけで、`useHighlights` がそれを本のエントリに書き込む
  ので、ページ上の色・一覧・会話の見出しが同時に追従する。**楽観的には書かない**（削除と同じ
  理由: 拒否されたら戻すことになり、読者は色が戻るのを見る）
- **質問ボックスは 2 つの用途を 1 つの入力欄で持つ**（`mode`: `ask` / `note`）。「メモを書く」で
  切り替えても打った文は残る。**色の列は用途で振る舞いが変わる**——質問のときは押した瞬間に
  その色で保存（名前は「黄でマーク」）、メモのときはメモの色を選ぶだけ（「黄を選ぶ」、
  `aria-pressed` 付き）で、保存は「メモ付きでマーク」。**送信中フラグは質問とマークで 1 つ**
  （`busy`）——質問の保存中にマークすると、同じ箇所のハイライトが 2 つになる
- **浮かぶボックスは色の列のぶん背が高い**ので、選んだ行から `POPOVER_LIFT_PX`（180px）上に
  置く（PDF と EPUB で共用。元は 130px）
- **提示バーの色は押した瞬間に保存する**。バーはフォーカスを取らないので、保存が終わるまで
  読者の選択はそのまま残る。保存できたら `handlePopoverDismiss` で選択ごと畳む（残すと、
  ハイライトの上にブラウザの選択が重なって見える）。バーの「メモ」は質問と同じ下端の入力欄を
  メモの用途で開く（`boxOpen` = `"note"`。`PdfViewer` / `EpubViewer` の `questionOpen` を
  用途つきに広げたもの）。**バーの 2 段目は 390px にちょうど収まる幅**なので、ボタンを足す
  ならどれかを削る（「メモを書く」ではなく「メモ」なのはこのため）
- **EPUB も同じ口を通る**。保存する `positionData` に `textRange` が載るのは質問のときと同じ
  （`EpubViewer` の `draftOf`）
- **変更の失敗は編集欄の中に出す**（`HighlightEditor` の `error`。上記「失敗の運び方」の表）。
  一覧の赤い枠（削除・検索の失敗）にも会話の `chatErrorAtom` にも合流させないのは、編集欄が
  一覧と会話の見出しの 2 箇所に出て、どちらにも別の失敗の枠があるため。編集欄は開いたままで、
  打ったメモも残る
- **会話の見出しの色とメモは本から読む**（`ChatArea` の `marked`）。`activeSelectionAtom` は
  箇所しか名指さないので、そこに色やメモを足すと SWR の写しになる（上記「`useEffect` の扱い」の
  「写し（禁止）」）。別のハイライトを開くと編集欄は閉じる（引用と同じくレンダー中に畳む）

**名前の衝突に注意**（下記「E2E の前提」の「ロケータの name は部分一致」）。足したボタンは
「黄でマーク」「黄を選ぶ」「黄に変える」「メモを書く」「メモ」「メモ付きでマーク」「メモを保存」
「メモと色」「やめる」と、一覧の行ごとの「「…」のメモと色を変える」。**「メモ」はほかの 5 つの
部分文字列**なので、E2E で名指すときは `exact: true` を付ける。一覧の行ごとのボタンは
「「…」を削除」と同じ書き出しになったので、`ChatArea.test.tsx` の 2 本は正規表現を
`/^「エッジは….*」を削除$/` に絞った（`/^「エッジは…/` のままだと 2 つに当たって落ちる）。

守っているテストは次のとおり。**狭い画面の提示バーの色・メモを通る E2E は無い**（jsdom の
`setViewportWidth` だけ。バーが 390px に収まることは手で見る）:

| 何を                                          | どのテスト                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 作成・変更・許可リスト・メモの空白と上限・404 | `test/worker/pdf.test.ts` の `POST /api/pdf/:pdfId/selections` と `PATCH /api/pdf/:pdfId/selections/:selId` |
| メモで見つかる（`%` のエスケープ込み）        | 同 `GET /api/pdf/:pdfId/search`「finds a highlight by the note written against it」                         |
| 色の列・用途の切り替え・送信中の 1 本化       | `SelectionPopover.test.tsx`「marking without asking」                                                       |
| チャットを開かずに保存する・失敗の運び方      | `useAskAboutSelection.test.tsx`「marking a passage without asking」                                         |
| 保存された色で描く・変更がキャッシュに載る    | `useHighlights.test.tsx`                                                                                    |
| ビューアの配線（マウス・バー・メモ・失敗）    | `PdfViewer.test.tsx`「marking a passage without asking」、`EpubViewer.test.tsx` の 1 本                     |
| 一覧のメモ表示と編集欄                        | `HighlightListPanel.test.tsx`「colours and notes」                                                          |
| 会話の見出しから変える                        | `ChatArea.test.tsx`「changes the open highlight's colour and note…」ほか 2 本                               |
| 実ブラウザで色とメモがリロードを越える        | `e2e/chatbook.spec.ts`「a passage marked in a colour with a note keeps both through a reload」（desktop）   |

#### ハイライト一覧の検索はサーバ、削除はパネルが持つ

一覧（`src/front/components/ChatArea/HighlightListPanel.tsx`）は**データ源を読まない
props のコンポーネントのまま**で、自分で持っているのは削除ダイアログの開閉と直近の削除失敗
（`actionError`）、それにどの行の編集欄を開いているか（`editingId`。一度に 1 つ）だけ。
各行にはメモがあれば本文の下に出す（行の色の縦線つき。読み上げでは「メモ:」と前置きする）。**検索欄はパネルが描くが、値も結果も持たない**——入力と SWR は
`src/front/hooks/useHighlightSearch.ts` にあり、`ChatArea` がそれを呼んで
`query` / `onQueryChange` / `onSearch` / `searched` / `searchError` と、絞り込み済みの
`highlights` / 本の総数 `total` を props で渡す。

**一覧は本そのものへの質問の入口でもある**（`onOpenBookChat`）。「本について質問する」を
**2 つの面の両方に置く**——ハイライトが 1 つも無い案内の中と、一覧のヘッダー直下。片方だけに
すると、ハイライトを 1 つ書いた読者から入口が消える。押すと `AppPage` の `openBookChat` が
本の会話を開く（一覧の行と違って、押した時点でページを動かさない）。返るのは「← 一覧に戻る」。

**範囲は質問ごとに選ぶ**（`src/front/components/ChatArea/ChatScopeMenu.tsx`）。会話の
ヘッダー右端のチップで、押すと「本全体」＋章のチェックボックスが出る。状態は
`chatScopeAtom`（`ScopeChapter[]`、空 = 本全体）で、本ごとのストアに載る。

- 章の一覧は `GET /api/pdf/:pdfId/chapters`（`useChapters`）から。**クライアントで目次を
  解き直さない**——範囲を解くのはサーバの `chapterSpans` 1 箇所
- **最後の 1 つを外すと本全体に戻る**。「何も選んでいない」を送信できない状態にしないため
- **「本全体」を選ぶとメニューが閉じる**。章は続けて選べるよう開いたまま（1 つ選ぶたびに
  閉じると複数選択ができない）
- **チップは 1 行に収める**。狭い画面のシートはヘッダー 1 行なので、`scopeLabel` は 2 つ目
  以降を「ほか N 件」と数える。メニューは `max-h-60 overflow-y-auto` で、シート半分でも
  スクロールして届く（**短い画面では下が見切れる**——横向きの電話など。シートを広げれば
  収まる）
- 目次の無い本は「この本には目次がありません」＋本全体のみ
- **EPUB はページ数を出さない**（spine 項目の番号でしかない。上記「本全体の % と今いる節」）

**検索の受け口は `GET /api/pdf/:pdfId/search?q=`**（`src/server/routes/pdf.ts` →
`pdfService.ts` の `searchSelections`）。**サーバで検索するのは、チャットが本の
レスポンスに載っていないから**——一覧は `GET /api/pdf/:pdfId` の `selections[]` から
描かれるので、会話の中身はクライアントに無い。本の存在を確かめたあと、**手書き SQL を 1 本**
で `selections.selected_text` と `selections.note` と `chat_messages.content` を見る（`EXISTS`。2 つの
検索に分けて後で混ぜると、片方だけ届いた瞬間に結果がちらつく）。**`findSelections` の
`db.prepare()` は service で唯一 drizzle を通らない**箇所で、`ESCAPE` を書くため——軸を
足すならここ。返すのは**該当した id だけ**（`{ selectionIds }`。`selectionSearchResultSchema`）
で、ハイライトそのものは一覧が既に持っている。**`ORDER BY` の結果は使われない**（一覧の
`newestFirst` が並べる）。

**検索も `ResultAsync` の service**で、無い本は `serviceFailureResponse` が
`PDF_NOT_FOUND` の 404 にする（例外なのは下記の削除だけ）。`q` は
`selectionSearchQuerySchema` が 1〜200 文字（`MAX_SEARCH_QUERY_LENGTH`）に絞り、外れると
400。**入力欄に `maxLength` は無い**ので、長い段落を貼れば読者には「検索に失敗しました」
として出る。

- 軸は**ハイライトの本文・メモ・そのチャットの本文**。色もページ範囲も軸にしていない——
  色は一覧の印で見分けがつき（4 つしかないので絞るほどの数にならない）、ページは読者が
  絞りたい単位（章）と一致しない
- **`%` と `_`、それにバックスラッシュ自身をエスケープする**（`likeContaining`）。素通しすると
  `%` の検索が本の全件に当たり、検索が壊れているようにしか見えない
- **大文字小文字を無視するのは ASCII だけ**（SQLite の LIKE の仕様）。`workers` は
  `Workers` に当たるが、日本語には効きも害もしない
- **`%…%` にインデックスは効かない**。1 冊分の `selections` と各行の `chat_messages` を
  走査する（絞れるのは `idx_selections_pdf_id` で本の範囲まで）。1 冊のハイライトが数百の
  うちは足りるので FTS5 は入れていない
- **入力は 1 行に収める**（何かを足すときも）。狭い画面では同じ一覧が `ChatSheet` の中に
  出て、half（ペインの 46%）だと縦が無い
- **打つことは検索することではない**。サーバへ行くのは検索ボタンか Enter を押したとき
  だけで（`submit` が `query` を `term` へ移す）、打っている間は一覧が動かない。日本語を
  打つ読者にとっては、変換中の文字列で検索が走らないことが要（debounce ではこれが守れず、
  変換の途中経過が毎回サーバへ行く）
- **Enter の判定は `isSubmitKey`**（`ChatInput` と共用）。変換を確定する Enter は IME の
  ものなので検索を走らせない——ここを素の `key === "Enter"` に戻すと、日本語の語を確定
  するたびに検索が走る
- **検索していないときのヘッダは `ハイライト N件` のまま**。検索を実行した後だけ
  `ハイライト N件中 M件` に変える。どちらも E2E と jsdom が完全一致で照合している。
  切り替えを決めるのは**検索が走ったか**（`searched` = `matchedIds !== null`）で、
  箱の中身（`query`）ではない——打っただけでヘッダが動くと、まだ絞られていない一覧に
  絞られたという顔をさせることになる
- **次の答えが来るまで前の結果を見せたまま**にする（SWR の `keepPreviousData`）。検索を
  押し直すたびに一覧がいったん全件へ戻ると、読者は絞り込みが解けたのかと思う
- **一致が 0 件でも入力欄と検索ボタンは残す**（消すと検索を解除する手段がなくなる。
  **解除は箱を空にして検索を押すこと**で、空にしただけでは前の結果のまま）。本に
  ハイライトが 1 つも無いときだけは、入力欄ごと出さずに始め方の案内を出す
- **検索が失敗しても一覧は隠さない**——検索できなかったことと、一致が無かったことは別。
  ただし**見えるものは前項が決める**: まだ一度も結果が来ていなければ全件、来ていれば
  前の検索語のままの一覧が残り、理由だけが上に出る。**理由を出す枠は削除の失敗と共有**で、
  削除の失敗が出ている間は検索の理由は出ない（`actionError ?? searchError`）
- **検索語はチャットを開いても残る**（フックが `ChatArea` にあり、一覧の unmount で
  消えない）。戻れば絞り込まれたままの一覧に戻る
- **検索中に増えたハイライトや保存された回答は結果に入らない**（検索は本とは別のキーなので、
  本の更新では再検索されない）。打ち直せば入る

**削除の受け口は `DELETE /api/pdf/:pdfId/selections/:selId`**（`src/server/routes/pdf.ts`）。
ここは **service を挟まない唯一の削除**で、`pdfService` の `ResultAsync` も
`serviceFailureResponse` も通らず route が drizzle を直に叩く。**無い id も成功で返す**
（404 にしない。E2E が本のハイライトを掃除するのにこの冪等性を使っている）ので、画面に出る
削除の失敗は回線断か 500 だけ。チャットは D1 の `ON DELETE CASCADE` が落とす。
前後の形は `src/shared/schemas/selection.ts` の `selectionDeletedSchema`。

- 削除は行の**外**に置いたボタンから（行全体が `<button>` なので、中に入れると
  button の入れ子になる）。当たり判定は 44px 角（`h-11 w-11`。同じ一覧を電話が指で使う）。
  **hover で出し入れしない**——上記「狭い画面のリーダーは 1 カラム」の入力の表が数え上げて
  いる hover 分岐（`src/` に 2 箇所）を増やさないため。確認は
  `src/front/components/ConfirmDialog.tsx`（本棚の削除と共用）で、**チャット履歴も
  消えることを文面に書く**
- **削除の失敗は検索行の下に出る**（検索の失敗と同じ枠で、こちらが優先）。消えるのは
  **次の削除を実行したとき**だけで、ダイアログをキャンセルしても残る。ただし読者が
  チャットを開いていれば一覧ごと消えているので届かない（上記「意図的に握りつぶす」）
- **削除の答えが返るまでに読者が別の操作をしうる**。ダイアログを閉じてから待つので、その間に
  PDF 上のハイライトをタップしてチャットが開くことがある。開いているチャットを畳む判断は
  `selectionDeletedAtom`（`src/front/atoms/chatAtom.ts`）が**その時点の store を読んで**
  行う——ハンドラの中で `activeSelection` を見るとレンダー時に捕まえた値（一覧が出ていた
  ときの `null`）を読むので届かない。atom を空にすれば `?selection=` も読書位置も追従する。
  配線は `ChatArea` の `onDelete`（`removeHighlight(book.id, id)` が成功したら
  `selectionDeleted(id)` を撃つ。**本の id は hook に渡したものと同じでなければならない**
  ——リクエストは引数の id へ飛ぶが、ハイライトが消えるのは hook の `pdfId` の一覧）

以前あった「削除すると同じセッションで作ったハイライトの色が 1 つずれる」割り切りは、
色を保存された値で描くようにしたので無くなった（上記「ハイライトは質問しなくても作れる」）。

守っているテストは次のとおり。**狭い画面でこの UI を通る自動テストは無い**（`mobile` /
`tablet` の E2E にも jsdom の `setViewportWidth` にも無いので、シートの中の見え方は手で見る）:

| 何を                                            | どのテスト                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 検索の SQL（本文・メモ・チャット・`%`・他の本） | `test/worker/pdf.test.ts` の `GET /api/pdf/:pdfId/search`（9 件。**チャット本文で見つかることを守る唯一の場所**） |
| 入力と実行の分離・失敗の運び方                  | `src/front/hooks/useHighlightSearch.test.tsx`                                                                     |
| 一覧の見え方・削除の確認と失敗表示              | `HighlightListPanel.test.tsx`                                                                                     |
| 検索結果で一覧が絞られる                        | `ChatArea.test.tsx`「narrows the list to what the server says holds the query, chats included」                   |
| サーバが落とした分だけキャッシュから除く        | `useHighlights.test.tsx`「takes a highlight the reader deleted out of the list without re-reading the book」      |
| 失敗しても一覧に残す                            | 同「keeps the highlight and hands back the reason when the server refuses to delete it」                          |
| 開いているチャットを畳む                        | `src/front/atoms/chatAtom.test.ts`「leaves the chat of a highlight that has just been deleted」                   |
| 待っている間に開かれたチャットを畳む            | `ChatArea.test.tsx`「leaves the chat a reader opened on a highlight while its deletion was in flight」            |
| サーバから本当に消えている                      | `e2e/chatbook.spec.ts`「a highlight deleted from the list stays gone after a reload」（desktop 1 本）             |
| 検索が実際にサーバを通る                        | 同「searching the list narrows it to what the server matched」（本文の検索だけ。理由は下記）                      |

**チャット本文で見つかることを E2E に足していないのは、実キーが要るから**ではない——質問
（user のメッセージ）は LLM を呼ぶ**前**に保存されるので、ダミーキーでも D1 には残る。
足していないのは、**送信すると上流に繋がろうとして失敗するまで待つことになり、かかる時間が
読めない**ため（`.dev.vars` の節にある「60 秒のタイムアウトまで粘る」がこれ）。保存できないの
は回答（assistant）の方で、そちらは実キーが要る。チャット本文の検索は worker テストが持つ。

#### 本文の検索は `full_text` を引き、結果は引用と同じ印で示す

ハイライト一覧の検索（上記）とは別物で、**本そのものの文章**（PDF のページ、EPUB の章）を探す。
受け口は `GET /api/pdf/:pdfId/find?q=`（`/search` はハイライト一覧のもの。名前を混ぜないこと）。

| 何を                                          | どこが                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 照合・ページ分割・スニペット（純関数）        | `src/server/services/bookTextSearch.ts` の `findInBookText`                                 |
| 本を引いて照合に渡す service（`ResultAsync`） | `pdfService.ts` の `findInBook`（`full_text` だけを select する。無い本は 404）             |
| front と server が交わす形                    | `src/shared/schemas/bookSearch.ts`（`q` は trim して 1〜200 文字、結果は 200 件で打ち切り） |
| 入力と実行の分離・SWR                         | `src/front/hooks/useBookTextSearch.ts`（実行した語は `bookSearchTermAtom`）                 |
| パネル（広い画面は横、狭い画面はドロワー）    | `src/front/components/PdfViewer/BookSearch.tsx`。置くのは `AppPage` の PDF ペインの左端     |
| 開く口                                        | ヘッダーの「本文検索」、`PageToolbar` の「検索」（`aria-label` は「本文検索」）、vim の `/` |

- **応答は一致ごとに `{ pageNumber, before, match, after }`** と `truncated`。`match` は検索語では
  なく**本の綴りそのまま**（大文字小文字・改行を含む）で、印はこれで付ける。`before` / `after` は
  同じページの前後 40 文字（`SNIPPET_CONTEXT_LENGTH`）で、空白の連続は 1 つに畳んである。
  **一致はページをまたがない**（送り先のページが 1 つに決まらないため）。同じページでは重ならない
- **照合の規則は 3 つ**: 両側を NFC にそろえる、長さの変わらない文字だけ小文字にそろえる（ASCII
  を含む。伸びる文字はそのまま残して元の位置へ戻せるようにする）、**空白は改行も含めてすべて
  落とす**。畳むだけでは足りない——pdf.js は版面の行末で改行を入れるので、日本語では語の途中で
  切れる（「日本\n語」）。代償は「foo bar」が「foobar」にも当たること。印を付ける
  `locateQuoteInSpans` も空白を落として照合するので、ここで当たったものはページ上でも見つかる
- **結果を押すことは引用リンクを押すことと同じ**: `currentPageAtom` と `citedPassageAtom` を書き、
  `PdfViewer` / `EpubViewer` の既存の引用の印がそのまま付く。URL は `useReadingLocation` が
  ページの変化を見て書く（このパネルは URL に触れない）
- **同じ語がページに何度もあるので、印の位置は前後の文脈で決める**。`CitedPassage` の任意の
  `context`（`{ before, after }`）を `locateQuoteInSpans` / `rangeOfQuote` が受け、
  `before + match + after` が並ぶ箇所の `match` に印を付ける。見つからなければ従来どおり最初の
  出現（引用リンクは `context` を渡さない）
- **パネルはビューアの中ではなく `AppPage` に置く**。PDF と EPUB で同じものが要り、検索に
  描かれたページは要らない（ビューアの中の目次はドキュメントが届くまで出ない）。広い画面では
  ページの横に並び、目次と同じくページを測り直させる。押しても開いたまま（次の結果へ進める）。
  狭い画面ではページを覆うドロワー＋暗幕（「検索を閉じる」）で、結果を押すと閉じる。
  **ツールバーの「目次」と「検索」は互いを畳む**——どちらのドロワーも左端に出て、目次（ビューアの
  中）が後に描かれるので、両方開くと検索が隠れる
- **開閉も検索語も保存しない**（本ごとのストアに載るだけ）。パネルを畳んでも実行した語は atom に
  残り、開き直すと SWR のキャッシュから同じ結果が出る
- **ボタンの名前は「本文検索」（開閉）と「本文を検索」（実行）**。ハイライト一覧の「検索」を
  部分一致で名指す E2E は `exact: true` にしてある（上記「E2E の前提」のロケータの注意）

守っているテストは次のとおり:

| 何を                                            | どのテスト                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 照合の規則・文脈・打ち切り                      | `src/server/services/bookTextSearch.test.ts`                                                                                              |
| ルート（形・別の本・ハイライトを見ない・400）   | `test/worker/pdf.test.ts` の `GET /api/pdf/:pdfId/find`                                                                                   |
| 文脈で出現を選ぶ                                | `citedPassage.test.ts` / `epubTextRange.test.ts`                                                                                          |
| パネルの見え方・IME の Enter・押したときの atom | `src/front/components/PdfViewer/BookSearch.test.tsx`                                                                                      |
| ヘッダー・ツールバー・`/` の配線                | `AppPage.test.tsx`                                                                                                                        |
| 実際に印が付く                                  | `e2e/chatbook.spec.ts`「searching the book's text turns to the page…」（同じ語が 6 行並ぶページの 3 つ目）と「searching an EPUB's text…」 |

#### リーダーの URL は `useReadingLocation` が単独で書く

リロードと共有リンクで同じ状態に戻るよう、リーダーの状態は 2 つのクエリパラメータに
載っている。**書き手は `src/front/hooks/useReadingLocation.ts` 1 つだけ**で、これを
分けてはいけない——`setSearchParams` は同一 commit 内でマージされないので、書き手が 2 つ
あるとハイライトを選んだとき（`page` と `selection` が同時に動く）に片方が黙って消える。

| パラメータ  | 値                             | 反映先 atom           | 省略時の扱い                                       |
| ----------- | ------------------------------ | --------------------- | -------------------------------------------------- |
| `page`      | 1 以上の整数（例: `5`）        | `currentPageAtom`     | 1。既定値でも `?page=1` と書き出す                 |
| `selection` | ハイライトの ID（例: `01KZ…`） | `activeSelectionAtom` | チャットを開いていない（ハイライト一覧）ことを表す |

`page` は既定値も明示するが、`selection` の「無い」は省略で表す（null を綴る自然な形が
無いため）。**`page` / `selection` / `#:~:text=` がどれも無い＝本棚から開いたときだけは、
書き出しをサーバの読書位置が決まるまで待つ**（下記「読んでいた場所は本と一緒に運ぶ」）。

**載っているのは場所だけで、目次とチャットパネルの開閉は載せない**。あれは本ごとに
サーバへ保存する（下記「読んでいた場所は本と一緒に運ぶ」）。**URL とサーバの二重管理に
戻さないこと**——URL に焼き付いた開閉は、ブラウザの履歴や共有リンク越しに何度でも戻って
きて、そのたびサーバの保存値を上書きする（畳んだはずの目次が開いたまま復活するのがこれ）。
`useReadingLocation` は本を開いた時点と書き出しのたびに `RETIRED_PARAMS`（`panel` / `outline`）を
`delete` するので、その形の古いリンクで開いてもパラメータはアドレスバーから消え、開閉は
本の保存値どおりになる（`e2e/chatbook.spec.ts` の「an old link naming the panels no longer
has a say over them」が守る）。**掃除は本の到着を待たない**——場所を名指さない URL では
書き出し自体が本待ちなので、待たせると取得が失敗した本でパラメータが残り続ける。

Chrome の「ハイライトへのリンクをコピー」が書く `#:~:text=`
フラグメント（`src/front/lib/textFragment.ts` が解析する）は `?page=` より優先する——
送り手がたまたま開いていたページより、名指しされた引用文の方が読者の目的に近いため。

`selection` の復元だけは**本（`useBook` の SWR）の到着を待つ**。ハイライトは本から読むため。
待っている間は URL の値を温存し（`pendingSelectionId`）、その間のページ送りで空の atom から
`?selection=` を消してしまわないようにしている。本から消えたハイライトを指す URL は一覧を
表示し、パラメータ自体を落とす。

**`?selection=` の復元では現在ページを動かさない**（URL の `page` が正）。一覧から選んだ
ときだけそのハイライトのページへ移るので、`setCurrentPage` は `AppPage` の
`handleSelectionClick` にあり、復元と共用する `openChat` には入れない。**ここを `openChat`
に戻すと、途中まで読んで再訪したときにハイライトのページへ引き戻される。**
（サーバの読書位置からの復元だけはページも動かす。下記「読んでいた場所は本と一緒に運ぶ」）

**チャットだけは SWR に載っていない**。`chatMessagesAtom` が持ち、履歴の読み込みは
`AppPage` の `openChat` が `resultFetcher` を直接呼ぶ。理由は、同じ状態を SSE の
ストリームがトークンごとに書き換えるため（`useChatStream`）——キャッシュに載せると
再検証が流れてきた回答を上書きしうる。**「データ取得はすべて SWR」ではない**。
イベントハンドラ起点の 1 回きりの取得（履歴・選択の作成）は SWR を通さず `resultFetcher`
で書く（受け皿になる SWR が無いので、失敗は値で返さないと消える）。**アップロードだけは
`postWithProgress`**——進捗を出すために XHR を通すため（上記「失敗の運び方（neverthrow）」）。

SWR の使い方で押さえるところ:

- **fetcher は必ず `src/front/lib/fetcher.ts` の `fetcher` を通す**（上記
  「外部入力のバリデーション（zod）」）。`useSWR(key, () => fetch(...).then(r => r.json()))`
  のように生 `fetch` を渡すとスキーマ検証を素通りし、`ApiError` / `INVALID_RESPONSE`
  の防護が消える。SWR の `error` state が受け止めるので、ここは throw する `fetcher` の
  ままでよく、`resultFetcher` に替えない。現在の SWR 呼び出しは全て `fetcher` 経由。
  **JSON ではない 2 つ——PDF バイナリ（`usePdfDocument`）とチャットの SSE
  （`useChatStream`）——だけが生の `fetch` を直接使う**。どちらも SWR ではなく、拒否の
  読み取りは `fetcher.ts` の `readRefusal` を通して同じ文言に揃える
- **ルートの `SWRConfig`**（`src/front/main.tsx`）で `revalidateOnFocus` を切っている。
  ローカル単一ユーザーのアプリでデータは自分の操作でしか変わらず、focus 復帰の再検証は
  Playwright のフォーカス往復で E2E を非決定にするだけ
- **本のキーは `src/front/hooks/useBook.ts` の `bookKey(pdfId)`（= `/api/pdf/:pdfId`）1 本**。
  リーダー（`AppPage`）・ビューア・チャットパネルが同じキーを共有するので本の読み取りは
  1 回で済み、ハイライトの追加も全員に同時に映る。ハイライト一覧は
  `useHighlights` がこのエントリの `selections` から導出する（色のパレット補完込み）ので、
  **専用の atom を作らないこと**——SWR のキャッシュ自体が共有のグローバル state で、
  atom と二重管理すると必ずずれる。**削除も同じキーを通す**（`removeHighlight`。
  サーバが落としたものだけをキャッシュから除くので、一覧・ページ上のハイライト・
  `PageToolbar` の件数が同時に追従する）。**検索だけは別のキー**
  （`/api/pdf/:pdfId/search?q=`。検索語ごとに 1 エントリで、返るのは id の配列）
  ——本のキャッシュを絞り込んだ結果で上書きすると、ページ上のハイライトまで消える
- **本は props、ハイライトは購読**という線引きは意図的。本の見出し（id / fileName /
  pageCount）は開いている間変わらないので props で足りる。ハイライトは `PdfViewer` が
  足して `ChatArea` が一覧する——兄弟どうしが同じ更新を見る必要があるので、
  `BookReader` へ持ち上げず同じキーの購読で共有する
- **アップロード時のキャッシュ先充填**: `useOpenPdfBook` が `POST /api/pdf/open` の結果を
  `mutate(bookKey(id), ..., { revalidate: false })` で先に書く。遷移先の
  `AppPage` がキャッシュヒットで即座に開くため。先充填の `selections` は空・
  `hasThumbnail` は推定値なので、**マウント時の再検証を止めないこと**——
  既にハイライトのある本を開き直したとき、一覧が空のまま固定される。
  `hasOutline` だけは推定ではなく抽出結果から正確に立てる（この同じアップロードが
  目次を保存したので、リーダーの後追い保存を空撃ちさせないため。上記「LLM の呼び分け」）
- **リーダーの state は本ごとに作り直す**: `AppPage` が `pdfId` を key にした jotai
  `Provider` を張る。開いているチャット・選択・ページはどれも 1 冊に属するので、
  個別に reset する代わりに store ごと捨てる。本自体は store の外（SWR）にあるので残る。
  **本をまたいで残したい設定は store に置けない**——`atomWithStorage` +
  `{ getOnInit: true }` で localStorage に持たせる（`settingsAtom.ts` の
  `keybindingModeAtom` / `useWebSearchAtom` がその形）。本ごとに別の値を
  残すもの（ビューアの倍率）はキーに pdfId を入れ、`zoomAtomFor(pdfId)` が
  `chatbook:zoom:<pdfId>` の atom を Map で使い回す。**atom は毎レンダー
  作り直せない**（別のオブジェクトは別の state になる）。jotai の
  `atomFamily` を使わないのは非推奨で本を開くたびに警告を出すため
- **テストの差し替え口は 2 つある**。取得そのものを差し替えるなら DI 引数——
  `useBook(pdfId, loadBook)` / `useHighlights(pdfId, loadBook, deleteHighlight, updateSelection)` /
  `useHighlightSearch(pdfId, search)`（既定は `requestSelectionSearch`）/ `extractPdfData(file, { createOcrEngine })`（OCR のエンジン。テストは `pdfOcr.ts` の `OcrEngine` を偽物で満たす）/
  `usePdfDocument(pdfId, book, fetchFn, buildDocument)`（**アップロードの手渡しだけは DI
  ではない**——モジュールの 1 枠なので、テストは `rememberUploadedFile` で置き
  `forgetUploadedFile` で片付ける。SWR の既定キャッシュと同じ扱い）/
  `useChatStream(fetchFn, now)` /
  `useAskAboutSelection(addHighlight, saveSelection)` /
  `useReadingStateSync(pdfId, locationReady, save, debounceMs)`（**時間も DI**。テストは
  デバウンスを短くして偽タイマーで進める）/
  `ShelfPage({ loadBooks, deleteBook, extract, createUploadRequest })`（どちらも
  `extract` と `createUploadRequest` の 2 つが `useOpenPdfBook(extract, onProgress,
createRequest)` へ渡る。**`onProgress` は props ではない**——`ShelfPage` が自分で組み立てる
  クロージャで、割合が 1 に達したら `storing` へ切り替える写像を持つのはそこ 1 箇所。
  **アップロードだけは `fetch` ではなく XHR なので、`vi.stubGlobal("fetch", ...)` では
  止められない**——`src/test/fakeUpload.ts` の `fakeUpload()` が作った `request` を返す関数を
  渡し、`uploaded()` / `answers()` で進捗と応答をテストが決める。`extract` は
  `(file, { signal, onOcrProgress })` を受け取るので、偽の `extract` がそれを呼んで OCR の
  進捗と中止を演じる）/
  `PdfViewer({ measureSelection, saveSelection, loadOcrText })`（`loadOcrText` は `useOcrText(pdfId, hasOcr, load)` へ渡る）/
  `ChatArea({ readQuote, deleteHighlight, changeHighlight, searchHighlights })` がその口。`measureSelection` は
  ポップオーバーを開く唯一の入口で、**実 DOM 選択と pdf.js が描いたページを両方要求する
  経路（質問・保存失敗の表示・二重送信の防止）を jsdom で動かすための seam**。
  キャッシュの中身を用意したいなら `src/test/swrTestCache.tsx` の `SwrTestCache` で包む
  （SWR の既定キャッシュはモジュールレベルの singleton なので、包まないとテストが互いの
  キャッシュを見て実行順に依存する。`seed` を渡すとそのキーをサーバの代わりに使う）。
  例外は**書き込まれたキャッシュの中身を検証したいとき**で、`Map` への参照が要るため
  `useOpenPdfBook.test.tsx` は自前の `Map` を `SWRConfig` へ直接渡している

#### 読んでいた場所は本と一緒に運ぶ

端末を変えても続きから読めるよう、**ページ・開いていたチャット（ハイライトの会話か、本そのもの
の会話か）・目次とチャットパネルの開閉**を D1 の `pdfs` に持たせている
（`migrations/0002_add_reading_state.sql` が足す `last_read_page` / `last_read_selection_id` /
`last_read_outline_open`、`0003_add_reading_state_chat_panel.sql` が足す
`last_read_chat_panel_open`、`0006_add_book_chat_reading_state.sql` が足す
`last_read_book_chat`。5 列とも nullable で、**読んでいない本には戻る場所が無い**——それは
ページ 1 とは違う）。読み出しは本そのもの（`GET /api/pdf/:pdfId` の `readingState`）に載り、
書き込みは `PUT /api/pdf/:pdfId/reading-state`。

| 何を                                    | どこが                                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 保存（デバウンス 1 秒・離脱時の flush） | `src/front/hooks/useReadingStateSync.ts`                                                                                                                                            |
| 復元（本の到着待ち）                    | `src/front/hooks/useReadingLocation.ts` の `pendingRestore`                                                                                                                         |
| 保存・読み出しの service                | `src/server/services/pdfService.ts` の `saveReadingState` / `getPdf`                                                                                                                |
| front と server が交わす形              | `src/shared/schemas/book.ts`。読み出しは `readingStateSchema`、書き込みは `saveReadingStateRequestSchema`（開閉の 2 つと `bookChat` が optional）、応答は `readingStateSavedSchema` |

**EPUB の「ページ」は章**で、章の中のどの画面にいたかは運ばない（上記「画面ごとにめくる」）。
画面の割り付けは窓と書体で変わるので、保存した画面番号は別の端末では別の語を指すうえ、
文字位置を足すには `readingState` に列が要る。戻るのは章の先頭の画面。

**`bookChat` は場所の側**（`selectionId` と同じ種類）。`true` なら開いていたのは本そのものの
会話で、**同時に立つのは 2 つのうち片方だけ**。狭い画面でも送る——あちらに畳んでおく第 2 の
ペインが無いだけで、会話は開いている。省略された場合は保存値を保つ（パネル 2 つと同じ規則）。

**場所（ページとチャット）と開閉では、誰が正かが違う。** 開閉は広い画面ならどう開いた本でも
本が正で、到着時に保存値を当てる。場所は**URL が何も名指していないとき（＝本棚から開いたとき）
だけ**サーバの位置を使う——`?page=` も `?selection=` も `#:~:text=` も無いことが合図で、
1 つでもあれば URL が正（リロードと共有リンクの意味を壊さないため）。`?page=abc` のような
読めない値は「名指しなし」に落ち、サーバの位置が使われる。**退役パラメータは名指しに数えない**
ので、`?panel=closed` だけを持つ古いリンクは本棚から開いたのと同じ扱いになり、ページもサーバの
位置が使われる。

**本そのものの会話は場所より開閉に近い**——URL に載らず（`?selection=` が名指せるのはハイライト
の会話だけ）、本が届いた時点で `place.bookChat` を見て開く。ただし**URL がハイライトを名指して
いるときは譲る**（読者がそのリンクをたどって来たのだから）。判定は `urlNamesAChat`（ref）で、
`pendingSelectionId` は同じコミットではまだ null のため state では間に合わない。ページの規則
（`?page=` があれば URL が正）はそのままなので、リロードでは「ページは URL から・会話はサーバ
から」になる。

復元まわりで外してはいけない点が 7 つある。**当てるのは本ごとに 1 回だけ**（`pendingRestore`）
——本は開いている間に何度も届く（ハイライトを保存すると SWR が本を取り直す）ので、そのたび
当て直すと読者が開いたばかりのパネルを畳んでしまう。**サーバの位置を使う経路（本棚から開いた
とき）では、本が届くまで URL にも何も書かない**——先に `?page=1` を綴ると、誰も頼んでいない
ページがアドレスバーに入り、復元がそれと言い争う（URL が場所を名指した経路の書き出しは本を
待たない。退役パラメータの掃除だけはどちらの経路でも即座に行う——綴る場所を持たないので
言い争う相手がいない）。**この経路だけはページも動かす**——ページ・チャット・開閉は 1 つの
場所として同時に保存されたものなので、チャットだけ開くと別の場所に着地する。**本が届く前に
読者が動かしたものは復元しない**——ページは現在ページが 1 のままかどうかで、開閉は
`panelsWhenOpened`（本を開いた時点の値）と今の値が同じかどうかで判定する。ヘッダーのトグルは
本を待たずに押せるので、取得中に開いた目次が到着で畳み直されると、読者の選択がその場で
取り消される。**短くなった本に備えて最終ページで丸める**。**本が届かなければ復元も保存も
起きない**——`pendingRestore` が下りないので `locationReady` が立たず、本棚から開いた経路では
URL も書かれない（読者に見えるのは本の読み込みエラーだけなので、これで困る人はいない）。

**開閉は本の有無に関わらずここで決まる**——保存値があればそれ、`null`（広い画面が何も表明して
いない）や本自体が未読なら「開」。パネルは閉で始まるので、これが開ける唯一の口になる
（上記「狭い画面のリーダーは 1 カラム」の atom の段落）。

新しい約束を守るのは desktop の E2E 5 本（`e2e/chatbook.spec.ts` の
「a folded outline stays folded through a reload」「both folded panels come back when the book
is opened from the shelf」「an old link naming the panels no longer has a say over them」
「reloading brings back the folded panel and the chat that was open in it」
「comes back to the book's own conversation when the book is opened again」）。

復元が届かない経路が 1 つある。**アップロードから開いた本ではハイライトの会話だけ復元されない**
——`useOpenPdfBook` のキャッシュ先充填は `selections: []` なので、保存されていた
`selectionId` を解決できないまま復元が確定する（ページ・開閉・**本そのものの会話**は先充填の
`readingState` から戻る。あちらは解決すべきハイライトを持たない）。`last_read_selection_id` に
外部キーは張っていないので、別端末で消したハイライトを指す値も同じく一覧表示に落ち、次の保存
まで残る。

保存側は「取得」ではなく sink である。書き手はどれも複数ある——ページは `PageStepper`・
キーボード・端のタップ・出典リンク、目次（`outlineOpenAtom`）はヘッダーのトグル・キーボード
（`keybindings.ts` の `toggleOutline`。チャットパネルを動かすショートカットは無い）、
チャットパネル（`chatPanelOpenAtom`）はヘッダーのトグルと質問の保存（`useAskAboutSelection`。
広い画面のときだけで、狭い画面では `chatSheetAtom` を動かす）。それぞれに書き込みを生やさず、
全員が着地する 3 つの atom を 1 箇所で見る。
**`locationReady`（`useReadingLocation` の戻り値）が立つまでは何も書かない**——ページ 1 と
閉じたままのパネルを書き戻すと、復元中の場所を自分で消す。立った直後に
見えた場所は「保存済み」として扱い、サーバへ送り返さない。**保存に失敗しても再送はしない**
——帯を出したまま、次に場所が動いたときが再試行を兼ねる。**同じ本を複数の端末・タブで
開いたら後に書いた方が勝つ**（利用者が 1 人なので調停はしない）。

**開閉の同期は広い画面同士の話**。狭い画面はどちらも復元せず、保存ペイロードにも載せない
（`outlineOpen` / `chatPanelOpen` の省略＝サーバの保存値を保持）。目次はページを覆うドロワーで
ジャンプのたびに自分で閉じ、チャットパネルはそもそも動かす口が無い（あちらは `chatSheetAtom`
という別物）。どちらの値も広い画面が選んだものとは無関係なので、送れば上書きにしかならない。
`null` は「まだ広い画面が何も表明していない」で、閉とは別物——**閉は畳まれたまま復元され、
`null` は開いて始まる**。

**保存で `updatedAt` は動かさない**。本棚はそれで並ぶので、ページを送ることが本を開き
直すことになってしまう。同様に `storePdf` の再アップロード上書きは列を明示列挙しており、
**同じ本を開き直しても場所は残る**（アップロードの応答にも `readingState` が載る）。

**URL が場所を名指して開いただけでは、その場所は保存されない**（リロード・共有リンク・引用
リンク）。`locationReady` が立った瞬間に見えている場所は、そこがどこであれ「保存済み」として
シードされるため。送られるのはそこから何かが動いたとき——ページを送る・チャットを開く・
パネルを畳む——で、そのときは動いた先の場所が丸ごと送られる。**古い共有リンクを開いて何も
せずに閉じても、別端末の読書位置は動かない**。読み進めれば動く。

**マイグレーションを当ててから動かす**。`readPdf` / `storePdf` は drizzle が `pdfs` の全列を
明示列挙するので、`0002_add_reading_state.sql` / `0003_add_reading_state_chat_panel.sql` /
`0004_add_outline.sql` / `0006_add_book_chat_reading_state.sql` / `0007_add_dropbox.sql` / `0008_add_book_format.sql` /
`0012_add_page_direction.sql` が未適用の D1 に新しいコードを
載せると本を開く経路ごと 500 になる（列を絞って読む本棚一覧だけは生き残る。
`saveReadingState` が落ちるのは、その列を実際に送ったときだけ——開閉と `bookChat` は省略なら
`set` にも現れない。チャットは `outline` 列を select するので `0004` 未適用では 500）。
**`0010_add_selection_note.sql`（`selections.note`）も同じ**——`readPdf` はハイライトを
`selections` の全列で読むので、未適用の D1 では本を開く経路ごと 500、ハイライトの作成・変更・
検索も 500 になる。nullable な列の追加なので旧コードには無害で、先に当てればよい。
**`0011_add_book_title.sql`（`pdfs.title`）も同じ**——未適用の D1 では本を開く経路・本の追加・
本棚の一覧（これは `title` を select する）が 500 になる。nullable な列の追加で、先に当てればよい。
ローカルは `pnpm run db:migrate:local`、リモートは
`vp build` → `wrangler d1 migrations apply chatbook-db --remote` → `pnpm run deploy` の順。
**列の追加は旧コードに無害なので、先に当てるのが常に安全——ただし `0005_book_chat.sql` だけは
違う。** あれは `chat_messages` の作り直しで `pdf_id NOT NULL` を足すので、**旧コードは書けなく
なる**（旧 Worker は `pdf_id` を渡さない）。窓は「migration を当てた瞬間」から「新しいコードが
デプロイされ終わる」までで、その間に届いた回答が 1 件保存できなくなる（`CHAT_SAVE_FAILED` の帯が
出る。データは失われない）。順番は変えられない——先にコードを出すと `pdf_id` 列が無くて同じ
ように落ちる。E2E は Playwright が起動時に適用するので影響を受けない。
OCR の `hasOcr` は列ではなく R2 の head なので、ここに足すマイグレーションは無い（上記
「テキストの無い PDF（OCR）」）。

キーバインド（Vim / Emacs）は `src/front/lib/keybindings.ts` の `resolveAction` に
DOM 非依存の純粋関数として実装。`gg` や `C-c t` の2ストロークは `pending` プレフィックスで表現し、
タイマーを持たせない（挙動を決定的にしてテストできるようにするため）。
vim の `/` は本文検索を開く（`openSearch`。上記「本文の検索は…」）。emacs の `C-s` には
割り当てない——ブラウザの保存を奪うことになるため。

**方向キー（`←` / `→` でページ送り、`↑` / `↓` でスクロール）はモードに属さない**。
`resolveArrows` がモード分岐より先に答えるので「なし」でも効き、そのぶん
`useKeyboardShortcuts` は**どのモードでも購読する**（`mode === "none"` の早期 return は無い。
戻せば「なし」を選んだ読者からキーボードが消える）。**修飾キーが付いていたら渡さない**——
とくに Shift + 方向キーは文字の選択を伸ばす操作で、ポップオーバーが読者に頼んでいるものそのもの。
設定メニューのヘルプも `ARROW_KEYBINDING_HELP` を全モード共通で先頭に出し、モード別の
`KEYBINDING_HELP` をその下に continue する（方向キーを 3 モード分書き写さないため）。組み立てる
のは `keybindingHelp(mode, direction)` で、右開きの本では `←` / `h` を「次」と書き換える。
**`←` / `→` と vim の `h` / `l` は画面の左右を指すので、どのページへ行くかは本の向きで決まる**
（右開きでは `←` が次。上記「ページめくりの向きは本ごとに持つ」）。emacs の `C-f` / `C-b` は
前後を指すので向きによらない。
**拡大中でもページを送る**——タップとスワイプは `ENLARGED_ABOVE` 超で送らないが、キーボードは
`h` / `l` を含めてその規約の外にある（拡大中に動かしたいのは `↑` / `↓` が担う）。

## テスト

ランナーが3つあり、それぞれ守備範囲が違う:

| ランナー              | 設定                       | 対象                                                                                |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| vitest (jsdom)        | `vite.config.ts`           | `src/**` の `*.test.ts(x)`（`src/front/**` と、workerd を要さない `src/server/**`） |
| vitest (workers pool) | `vitest.workers.config.ts` | `test/worker/**` の API（`SELF.fetch` / D1 / R2 を使うもの）                        |
| Playwright            | `e2e/playwright.config.ts` | ブラウザ実操作                                                                      |

jsdom テストと Workers pool テストは同一プロセスで共存できないため設定が分かれている
（`vite.config.ts` は `process.env.VITEST` のとき `cloudflare()` を無効化する）。

**Workers pool は外向きの `fetch` を msw で止める**（`test/worker/setup/msw.ts`。
`onUnhandledRequest: "error"`）ので、上流を叩くテストはハンドラを登録しないと落ちる。
**その上流は DeepSeek ではなく `https://llm.test`**——`vitest.workers.config.ts` が
`LLM_BASE_URL` / `LLM_MODEL` にテスト用の値を渡しているためで、env を読み落とした実装は
どのハンドラにも当たらずに落ちる（`test/worker/chat.test.ts` の `LLM_BASE` 定数がそれ）。

**jsdom 側は `include` を書かず `exclude` だけで拾っている**（`node_modules` / `dist` /
`test/worker/**` / `e2e/**` / `.claude/**` を除外）。そのため実装とコロケーションした
`src/server/services/*.test.ts` も自動的に jsdom で走る。バインディングを触らない純粋な
サーバロジック（`chatService` の引用パース、`llmService` の SSE パースを注入 fetch で
叩くもの）はこちらで書き、workerd の実物が要るものだけ `test/worker/**` に置く。
**`include` を足して絞ると、これらが無言で走らなくなる**ので注意。

### jsdom に無いものは `src/test/setup.ts` が埋める

jsdom はレイアウトを持たないので、幅にまつわる API がどれも無い。`setup.ts` が
`scrollIntoView` / `DOMMatrix` に加えて `ResizeObserver`（何も報せないスタブ）と
`matchMedia`（`src/test/viewport.ts` の差し替え可能なスタブ）、`Range` の
`getClientRects` / `getBoundingClientRect`（空の箱を返す。EPUB のハイライトの計測用）を置く。あわせて
`asyncUtilTimeout` を 5000ms にしている——選択の確定を 250ms 待つ経路があり、既定の
1000ms だと並列実行の負荷で毎回違うテストが落ちるため。

**`matchMedia` の既定は 1280px（デスクトップ）**にしてある。狭いレイアウトを前提にしない
既存のテストを 1 行も書き換えずに済ませるため。狭い幅で試すときは
`src/test/viewport.ts` の `setViewportWidth(PHONE_WIDTH)`（`PHONE_WIDTH` は 390px で、
Playwright の `mobile` プロジェクトと同じ幅）を呼ぶ。マウント後に幅を変えるなら `act` の中で。
幅は `setup.ts` の `afterEach` で毎回戻るので、テストの実行順に依存しない。

**タッチ対応をどこでテストするかは 8 段に分かれる**:

| 何を                                                    | どこで                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| ジェスチャの判定そのもの（帯・スワイプ・倍率）          | 純関数の単体テスト `src/front/lib/touchNavigation.test.ts`                                                              |
| 選択がいつ確定するか（押下・離す・通知の連続）          | jsdom + 合成 pointer イベント `src/front/hooks/useSettledSelection.test.tsx`                                            |
| 幅で変わる分岐（何が出る・出ない、どこへ繋がる）        | jsdom + `setViewportWidth(PHONE_WIDTH)`（`AppPage.test.tsx` / `PdfViewer.test.tsx`）                                    |
| 入力の種類で変わる分岐（`pointerType` / `detail`）      | E2E のみ（`e2e/chatbook.spec.ts` のマウスの端クリックと、質問ボックスを閉じるクリック）。jsdom には要素の寸法が無いため |
| hover の有無で変わる分岐（ページ送りの行）              | E2E で 2 本 1 組。**jsdom では触らない**（どちらも下記「hover の分岐は 2 本で 1 つの約束」）                            |
| 実際のタップとレイアウト                                | `e2e/mobile.spec.ts`（project `mobile`）                                                                                |
| 幅が広いまま指で触る組み合わせ                          | `e2e/tablet.spec.ts`（project `tablet`）                                                                                |
| 長押し選択・OS の選択メニュー・ソフトキーボード・ピンチ | 実機（ヘッドレスでは届かない。→ `docs/PDF_TEXT_SELECTION.md` §8）                                                       |

**`tablet` が独立して要るのは、幅ではなく入力で分けたことがほかのどこでも検証できないから**。
`mobile` は幅が狭いので幅で分けても通り、`desktop` はマウスしか使わないので指の経路を通らない。
その交差点（広い画面 × 指）だけが、幅で分けた実装をタブレットで壊す。**ただし E2E は CI にも
`pre-push` にも載っていない**（CI は `vp test` / worker のテスト / `vp check` / `vp build` だけ、
`pre-push` は `vp check` + `vp build` だけ）。入力で分ける約束を壊していないかは、
`pnpm run test:e2e --project=tablet` を手で走らせるまで誰も気付かない。

**hover の分岐は 2 本で 1 つの約束。**ページ送りの行が出ない側は `desktop` の
`keeps no row of page controls…`、出る側は `tablet` の `keeps the row of page controls…` が持つ。
**片方だけでは「どの端末でも非表示」と区別できない**ので必ず対で残す（互いのコメントが相手の
テスト名を書いてあるので、片方を消そうとすれば気付ける）。2 本まとめて走らせるなら
`pnpm run test:e2e -g "row of page controls"`（project をまたいでこの 2 本だけを拾う）。

**この行は jsdom では触らない。**Tailwind の CSS を当てないので `display: none` になったかを
見られないうえ、行は広い画面でも DOM に残る（条件は `book && !isNarrow` だけ）ので click できて
しまう。実機では見えないものを触る「動いていないのに通る」テストになる。

**jsdom で確かめられないもの**は E2E に置く。ページを描けないので、目次のドロワーのように
「描かれたページがあって初めて出るもの」はここでは検証できない（`PdfViewer` の
オーバーレイはポップオーバーか pdf.js のドキュメントが無いと DOM に入らず、
ポップオーバー経由だと外側 mousedown で先に閉じてしまう）。

### `.claude/**` を除外している理由

Claude Code はエージェント用の worktree を `.claude/worktrees/` に作る。これはこのリポジトリの
まるごとのチェックアウトなので、除外しないとメインクローンの `vp check` と `pnpm test` が
**別ブランチのファイルを拾う**。実際に起きるのは次の 2 つ:

- 作業中の未整形ファイルで `vp check` が落ちる（メインクローンのソースは健全なのに）
- worktree 側の `e2e/**` と `test/worker/**` が jsdom の実行に混ざり、
  `Playwright Test did not expect test() to be called here` や
  `Failed to resolve import "cloudflare:test"` で落ちる

`vite.config.ts` の `AGENT_WORKTREES` を `fmt.ignorePatterns` / `lint.ignorePatterns` /
`test.exclude` の 3 箇所に渡している。**各 worktree の中で実行する `vp check` は自分の
チェックアウトしか見ない**ので影響を受けず、CI もクリーンな checkout なので元から無関係。

### E2E の前提

- **プロジェクトが 3 つある**。読者の操作を決めるのは 2 つ——ウィンドウ幅がレイアウトを、
  ポインタの種類が入力の経路を決める。どちらも 1 回の実行に混ぜられないので、意味のある
  組み合わせごとに実行を分けている。`desktop` は既定幅（1280×720 px）をマウスで触って
  `e2e/chatbook.spec.ts`、`mobile` は 390×844 px・`deviceScaleFactor: 3`・`isMobile` / `hasTouch`（Playwright の `tap()` が使える）で `e2e/mobile.spec.ts`、
  `tablet` は 1024×768 px・`hasTouch` のみ（`isMobile` は付けない）で `e2e/tablet.spec.ts`。
  1 つだけ走らせるなら `pnpm run test:e2e --project=tablet`。新しいテストは、狭い画面の話なら
  `mobile`、指で触る話なら `tablet`、それ以外は `desktop` に置く。
  **`tablet` が見るのは 2 ペインのまま指で触ったとき**——選択とそこに出る提示バー・端のタップ・
  ハンドルのドラッグ・hover が無い端末での削除ボタンとページ送りの行。幅で分けた実装はここだけで壊れる
  （上記「タッチ対応をどこでテストするか」）。**ただし指の長押し選択そのものは合成できない**ので、
  選択のテストは中央の帯を 1 回タップして「指が触った」ことを立ててから `Range` API で作り、
  `selectionchange` で拾われることまでを見る（`pickPassageWithAFinger`）。
  **ハンドルを指でドラッグするには CDP の `Input.dispatchTouchEvent` が要る**
  （`setPointerCapture` はブラウザが実際に追跡しているポインタを要求するので、手で組み立てた
  `pointerdown` では捕捉が成立しない）
- **`desktop` は「今どのページか」をカウンタではなく描かれたページで見る**（`drawnPage` が
  `.textLayer span[data-page-number="N"]` を引く）。ページ送りの行が hover できる画面には
  出ないのでカウンタが無く、そのうえこの印は**ページが描かれてから付く**ので観測としても強い
  （カウンタは atom が変わった瞬間に切り替わるだけ）。付けているのは pdf.js ではなく
  `PdfPage.tsx` で、`textLayer.render()` が返ったあとに全 span へ貼る。消費者は E2E だけでなく
  `pdfTextMatcher.ts`（DOM の選択を文字位置へ戻す）と `citedPassage.ts`（引用の印を置く）も。
  ページを進めるのはキーボード（`l` / `h`）か端のクリック
- **`desktop` はチャットを畳むか、ページを縮めると見開きになる**（既定の 1280×720 で、目次は
  出したまま。上記「幅が余ったら 2 ページ並べる」）。`openTestBook` はチャットを開いた状態で
  着地するのでほとんどのテストは 1 ページだが、畳むテストと `pinchIn` するテストでは
  `canvas.block` が 2 つになる——数える・測るヘルパーが `.first()` で左ページを見るのはこのため。**pdf.js の span をドラッグするときは
  span の内側から内側へ動かす**（`box.x + 1` → `box.x + box.width - 1`）。テキストレイヤーの
  span は絶対配置なので、その外側で押し下げる `dragAcross`（チャットの本文用）では選択が
  始まらない
- **`tablet` / `mobile` はカウンタ（`pageLabel`）を見る**。どちらも `openTestBook` の読み込み
  待ちがそれなので、**あの行をこの 2 つで隠すと専用テスト 1 本ではなく spec 全件が 60 秒の
  タイムアウトで落ちる**
- **`workers` は 1**。3 つの spec は同じ D1 / R2 と同じ本（fixture が同じファイルなので
  同じ `pdfId`）を共有し、それぞれ開始時にその本のハイライトを全削除する。並行させると
  片方が、もう片方の検証している最中のハイライトを消す
  **`devices["iPhone 14"]` は使わない**——WebKit のインストールが要るうえ、iOS 固有の挙動
  （長押し選択と OS の選択メニューの競合、ソフトキーボードとシートの重なり）はどのみち
  ヘッドレスでは確かめられない。そこは実機で見る。**指のピンチは E2E では検証しない**
  （Playwright は指を 2 本送れない）。判定は `src/front/lib/touchNavigation.test.ts` が持つ。
  **トラックパッドのピンチ（ctrlKey + ホイール → `nextZoom`）は desktop の E2E が叩いている**
  ——`pinchIn` / `pinchOut` がそれで、倍率が見開きの入力になった今はページの枚数まで動かす
  （上記「幅が余ったら 2 ページ並べる」）。指のピンチが見開きを出せることを見るテストは無い
- **サーバーは Playwright が自動起動する**（`e2e/playwright.config.ts` の `webServer`）。
  下記の E2E 専用ストアを `rm -rf` してから、`wrangler d1 migrations apply`（`--persist-to` で
  そのストアを指す）と `vp dev --port <port> --strictPort` を順に実行するので、
  マイグレーション未適用の worktree でもそのまま走る。ここだけ `pnpm run db:migrate:local` を
  使わないのは、永続先を下記の E2E 専用ディレクトリへ向けるため。`reuseExistingServer: false`
  なので起動済みサーバーには相乗りせず、必ずこのチェックアウトのコードでテストする
- **ポートは worktree のパスから決定的に導出する**（5175〜5674 の範囲。`E2E_PORT` で上書き可）。
  5173 固定だと別クローンの `vp dev` に誤接続したまま「成功」しうるため。`--strictPort` により
  導出ポートが埋まっていれば黙って別ポートへ逃げず即座に失敗する
- **E2E は dev サーバーとは別の D1 / R2 を使う**。Playwright が
  `E2E_PERSIST_PATH=.wrangler/e2e-state` を渡し、`vite.config.ts` がそれを
  `cloudflare({ persistState: { path } })` に載せる（未設定なら既定の `.wrangler/state`）。
  **分けている理由は、テストがアップロードした本が読書中の本棚に現れないようにするため**。
  wrangler の `--persist-to` も plugin の `persistState` も渡したパスの下に `v3` を作るので、
  マイグレーションと Worker が同じストアを指せる
- **E2E のストアは実行のたびに作り直す**ので、前回の残骸に依存したテストは書けない。
  裏返すと、落ちた run のストアは次の run の冒頭までは残っている。中身を見たいときは
  `E2E_PERSIST_PATH=.wrangler/e2e-state vp dev` で同じストアを本棚から開く
- **同一 run 内のハイライトと読書位置は残る**。ハイライトはテキストレイヤーの上に乗るため、
  先行テストの残骸があると後続の選択テストを壊す。読書位置はサーバに残るので、先行テストが
  進めたページや畳んだパネルのまま次のテストが開いてしまう（3 spec は同じ fixture ＝同じ
  `pdfId` を共有し、アップロード後の遷移先はクエリの無い `/books/<id>` ＝サーバの位置を使う
  経路。パネルの開閉はどう開いてもサーバから来る——ただし狭い画面は復元しないので `mobile`
  には効かない）。各 spec が
  持つ `openTestBook`（`chatbook.spec.ts` / `tablet.spec.ts` / `mobile.spec.ts` に別々の実装が
  ある。共有していない）が開始前に selection を全削除し、ページめくりの向きを左開きに、読書位置をページ 1・両パネル開に
  戻す。**畳んだ状態から始めたいテストは URL ではなくサーバへ書いてから本を開き直す**
  （`chatbook.spec.ts` の `foldChatPane` → `page.goto`。復元は本の到着ごとに 1 回だけなので、
  `openTestBook` で本を開いたあとに書いただけでは畳まれない）
- **API が閉じているので、どのテストもまずログインする**。各 spec の `logIn` が
  `.dev.vars` のローカル用の資格情報で `POST /api/auth/login` を叩き、Cookie を
  ブラウザコンテキストに置く（Playwright は `page.request` と画面で Cookie を共有する）。
  `openTestBook` はその中で呼ぶが、**それを通らないテストは自分で `logIn` を呼ぶ**
- **テスト用 EPUB も同じくコードから生成してコミットしてある**（`e2e/fixtures/test-epub.epub`。
  中身は `e2e/fixtures/testEpubManifest.ts`、作り直しは
  `node --experimental-strip-types e2e/fixtures/generateTestEpub.ts`）。全エントリの日付を固定して
  いるので、manifest を変えない限り差分は出ない。**同梱の CSS は本文を赤くする**——読者の書体で
  描いていること（出版社の CSS を読まないこと）を E2E がそこで見ている。ファイル名を
  `test-book` にしないこと（本棚で PDF の fixture と同じ名前になり、カードを名指せなくなる）。
  **第 3 章は 1 ファイルに `#s3-1` / `#s3-2` の 2 節を持ち、目次がアンカーで指す**（実書籍で
  報告された「1 つの spine 項目に複数の節」の形。`sections`。本文は `chapterParagraphs` で
  節ごと取る）。
  **第 2 章と第 3 章は埋め草の段落で数画面ぶんある**（画面をめくる E2E と、第 1 章からの
  リンク先・本文検索の結果が章の先頭の画面に無いことのため）。埋め草に検索語を混ぜないこと
- **テスト用 PDF はコードから生成し、生成物をコミットしてある**（`e2e/fixtures/test-book.pdf`）。
  ページ数・目次のネストとページ・図版ページ・各ページの本文は
  `e2e/fixtures/testBookManifest.ts` にあり（`PAGE_COUNT` は現在 12）、spec もそこを読むので
  数値を直接書かない。**manifest か `generateTestBook.ts` を変えたら
  `node e2e/fixtures/generateTestBook.ts` で作り直し、PDF もコミットする**
  （`.ts` を直接実行するので Node 24 が要る）。編集の前に manifest のコメントを読むこと——
  章より先に節のページを置くと生成が落ちる、表紙に空白を入れると span が増えて選択テストの
  前提が崩れる、といった制約がそこにある。フォントは `e2e/fixtures/.cache/` へ自動ダウンロード
  （gitignore 済み）。同じ pdfkit・同じフォントなら出力はバイト単位で再現する
- **テキストの無い（画像だけの）fixture がある**（`e2e/fixtures/scanned-book.pdf`。中身は
  `e2e/fixtures/scannedBookManifest.ts`、作り直しは `node e2e/fixtures/generateScannedBook.ts`）。
  各ページの行を HTML で組み、E2E が入れてある Chromium で撮った PNG をページ全面に貼るだけで、
  テキスト演算子は 1 つも書かない——pdf.js が 1 文字も読めないスキャン本と同じ形。**グリフは
  生成した機械のフォント**（和文は Hiragino / Noto CJK）なので、別の機械で作り直すと画素が
  変わりうる（読むのは OCR だけなので、検索語が読める限り問題ない）。検索語は英語の 1 語
  （`SCANNED_SEARCH_WORD`）で、2 ページ目にしか無い。**E2E はここで本物の Tesseract を回す**
  （アセットは自前配信なのでネットワークは要らない。手元では 2 ページで数秒）。ファイル名を
  `test-book` にしないこと（本棚で同じ題名にまとまる）
- **CMap を要求する 2 冊目の fixture がある**（`e2e/fixtures/cid-font-book.pdf`。
  `e2e/chatbook.spec.ts` の `a book with CID-keyed fonts renders without asking for a CMap`
  が `CID_FONT_BOOK` として読む）。`test-book.pdf` は使うグリフをすべて埋め込むので
  **`cMapUrl` が無くても白紙にならず**、フォントの `/Encoding` に predefined CMap
  （`UniJIS-UCS2-H`）を名指した本だけがあの経路を通る。**`generateCidFontBook.ts` は
  pdfkit を使わず PDF を直接組み立てる**——pdfkit は常にサブセットを埋め込み、
  predefined CMap を名指す手段が無いため。フォントは埋め込まないので、グリフは
  ブラウザのシステムフォントで描かれる。
  `cMapUrl` を外すと 2 段で落ちる: pdf.js が `cMapUrl` を名指す警告を出し、テキストが
  1 文字も取れないので `POST /api/pdf/open` が `fullText` 空を 400 で拒む
  （`src/server/routes/pdf.ts`）
- **ドラッグしたのに何も選ばれないテストに当たったら、ヘッドレス Chromium の横位置を疑う**。
  ページの `getBoundingClientRect().left` の小数部が .734375 になる位置に来ると、ボタンを
  押したままの移動に選択を伸ばさず新しいキャレットを置き直し、ドラッグが何も選ばなくなる。
  切り分けは 3 手——ページの `left` を測って小数部を見る、
  `pnpm run test:e2e --project=desktop -g "<名前>" --headed` で同じ幅を再現して通るなら実装では
  ない、ウィンドウ幅を 1px ずらす。`main` でも同じ位置なら再現するので、ビューアの作りとは
  無関係なブラウザ側の癖。**踏んだテストだけ幅を固定する**（`e2e/chatbook.spec.ts` の
  "overshooting a line…" が既定の 1280px から 1px ずらして 1281px を指定しているのがそれ。
  ほかの実ドラッグのテストは既定幅か project の `viewport` のままでよい）
- **ロケータの name は部分一致**——`getByRole("button", { name: "質問する" })` は
  「**本について質問する**」にも当たる。本全体チャットの入口を足したときに実際に踏んだ:
  質問ボックスの開閉を見ていた 1 本が「常に 1 件ある」になって落ち、**同じ名前を使っていた
  他の 8 本は入口のボタンで通ってしまい、見張りが黙って消えた**（テストは green のまま）。
  ポップオーバーやパネルの中のボタンを名指すときは `{ name: "...", exact: true }` を付ける。
  ボタンのラベルを足すときは、既存の部分一致に当たらないか `rg` で確かめる
- UI の回帰テストを足したら、**実装を壊した状態で落ちること**を必ず確認する。
  ここは「動いていないのに通る」テストが生まれやすい。例: 計測用 canvas はサイズが 0 になる
  瞬間があるため box では検出できず `display` を見る必要があった。fixture の表紙に色を敷くのも
  同じ罠で、文字が 1 つも描けなくても「白紙ではない」判定が通ってしまう（だから表紙は白地に
  文字だけで描いている）

## 実装方針

- TDD（RED→GREEN→REFACTOR）
- ロジックは DOM に依存しない純粋関数へ切り出して単体テストする
  （`keybindings.ts` / `sseParser.ts` / `isSubmitKey.ts` がその例）
- 日本語入力を壊さないこと。Enter の送信判定は `isSubmitKey` を使い、IME 変換中
  (`isComposing` / `keyCode === 229`) は送信しない
- `worker-configuration.d.ts` は commit 済みの生成物。bindings か `main` を変えたときだけ
  `vp exec wrangler types` で再生成して commit する
- `wrangler.jsonc` の `assets.directory` は必ず `./dist/client`。トップレベル `./dist/` にすると
  Worker のビルド成果物（`.dev.vars` を含む）まで静的配信されてしまう
