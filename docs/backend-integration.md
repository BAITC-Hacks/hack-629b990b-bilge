# Подключение фронтенда к AI Sana

База HTTP: `http://localhost:3001/api/v1`. Swagger: `http://localhost:3001/api/docs`, JSON OpenAPI 3.1: `http://localhost:3001/api/openapi.json`. Схемы команд генерируются из тех же Zod-валидаторов, которыми сервер проверяет запросы. Браузерный клиент — `backend/client/index.ts`: runtime-зависимостей на сервер, SQLite и Node.js нет, импорты серверных типов стираются при сборке.

Из `backend/`: `npm ci`, скопируйте `.env.example` в `.env`, если файла ещё нет, затем `npm run seed`, `npm run dev`. Для живого AI нужен `OPENAI_API_KEY`; без ключа доступен явно обозначенный fallback. По умолчанию используются `gpt-6-luna`, reasoning `low`, 30 секунд и 4096 выходных токенов на AI-операцию. `GITHUB_TOKEN` необязателен для публичных repo/PR. Коды подготовленных профилей находятся в **локальном** `backend/demo-accounts.local.json`; seed создаёт случайные коды и не публикует их в репозитории. Сервер также запускает seed при старте. Разрешённые адреса фронтенда задаются в `ALLOWED_ORIGINS`; по умолчанию это `http://localhost:5173` и `http://127.0.0.1:5173`.

## Сессия в отдельной вкладке

Клиент возвращает весь envelope, сам не сохраняет токен и не повторяет запросы. `baseUrl` — полный префикс, включая `/api/v1`. При проксировании на том же origin параметр можно опустить. Фронтенд может импортировать клиент из соседней папки backend; не копируйте один файл без доступных type-only импортов.

```ts
import { createSanaClient, ApiError } from '../backend/client/index';
import type { WorkspaceView, InvalidationEvent } from '../backend/client/index';

const api = createSanaClient({
  baseUrl: 'http://localhost:3001/api/v1',
  getToken: () => sessionStorage.getItem('sana.token'),
});

async function signIn(code: string) {
  const { data } = await api.startSession({ code });
  sessionStorage.setItem('sana.token', data.token);
  return data.actor;
}

async function signOut() {
  await api.endSession();
  sessionStorage.removeItem('sana.token');
}

// Однократное создание новой команды вместо входа по подготовленному коду:
async function registerTeam(name: string) {
  const { data } = await api.createTeam({ name });
  sessionStorage.setItem('sana.token', data.token);
  return data.code; // Покажите пользователю и предложите сохранить код для следующего входа.
}
```

Откройте две независимые вкладки: в одной войдите кодом бизнеса, в другой — команды. `sessionStorage` изолирует последующие изменения токена между вкладками; новая вкладка, открытая через opener/дублирование, может сначала получить копию текущей сессии — выполните вход нужной ролью в ней. Не используйте общий `localStorage` для этого демо. `POST /teams/start` возвращает код только при создании и **не поддерживает** безопасное повторение через `Idempotency-Key`; не запускайте автоматический retry этого запроса.

## Форма ответа и состояние экранов

```json
{
  "data": { "screen": "task-workspace", "task": { "id": "…", "version": 3 } },
  "feedback": { "kind": "success", "message": "Черновик сохранён" },
  "meta": { "requestId": "…", "contractVersion": "1.0" }
}
```

Пример сокращён; полные типы экспортируются клиентом. `data` — готовая модель экрана BFF, а не строка таблицы. Команда возвращает обновлённый экран: заменяйте соответствующий кеш её `data`, показывайте `feedback?.message`. Чтение обычно возвращает `feedback: null`. `actions[].enabled/reason`, `nextAction`, `emptyState`, подписи полей и шаги уже подготовлены сервером. При этом сервер заново проверяет разрешения каждой команды. Ниже все 26 маршрутов типизированного клиента.

| Метод клиента | HTTP после `/api/v1` | Данные и доступ |
| --- | --- | --- |
| `health()` | `GET /health` | Проверка сервера/базы; публично |
| `bootstrap()` | `GET /bootstrap` | Actor, возможности, навигация; гость допустим |
| `startSession({code})` | `POST /session/start` | Token, actor, expiresAt |
| `endSession()` | `POST /session/end` | Завершить текущую сессию |
| `createTeam(input)` | `POST /teams/start` | Команда, сессия и одноразовая выдача кода |
| `catalog(filters?)` | `GET /catalog` | Фильтры, карточки и мир; только опубликованное |
| `dashboard()` | `GET /dashboard` | Кабинет текущей роли; нужна сессия |
| `scoreboard()` | `GET /scoreboard` | Только name, confirmedPoints, rank |
| `snapshot()` | `GET /snapshot` | Bootstrap + catalog + dashboard + scoreboard |
| `startTask(input, options?)` | `POST /tasks/start` | Workspace; только бизнес |
| `task(id)` | `GET /tasks/{id}` | Публичная карточка и свои отклики команды |
| `workspace(id)` | `GET /tasks/{id}/workspace` | Workspace; только владелец |
| `reviewDesk(id)` | `GET /tasks/{id}/review` | Сравнение откликов и этапы; только владелец |
| `saveDraft(id, input)` | `POST /tasks/{id}/draft` | Частичный fields → workspace |
| `applyAnswers(id, input)` | `POST /tasks/{id}/answers` | Ответы по field → workspace |
| `clarifyTask(id, {expectedVersion})` | `POST /tasks/{id}/clarify` | 3–5 вопросов → workspace |
| `analyzeTask(id, {expectedVersion})` | `POST /tasks/{id}/analyze` | Цитаты для пустых полей → workspace; владелец |
| `applySuggestions(id, input)` | `POST /tasks/{id}/suggestions/apply` | Выбранные ID или отклонение всех → workspace; владелец |
| `confirmTask(id, {expectedVersion})` | `POST /tasks/{id}/confirm` | Подтверждённый снимок → workspace |
| `publishTask(id, {expectedVersion})` | `POST /tasks/{id}/publish` | Публикация → workspace |
| `propose(id, input, options?)` | `POST /tasks/{id}/proposals` | Обновлённая карточка; команда |
| `decideProposal(id, input)` | `POST /proposals/{id}/decision` | Review desk; владелец задачи |
| `createMilestone(taskId, input, options?)` | `POST /tasks/{id}/milestones` | Этап; выбранная команда |
| `milestone(id)` | `GET /milestones/{id}` | Этап; своя команда или владелец задачи |
| `submitEvidence(id, input)` | `POST /milestones/{id}/evidence` | Этап после отправки; своя выбранная команда |
| `decideMilestone(id, input)` | `POST /milestones/{id}/decision` | Этап после решения; владелец задачи |

У задач `expectedVersion` берите из `workspace.task.version`; у решения по отклику — из `proposal.version`; у этапа — из `milestone.version`. После каждой команды используйте версию из нового ответа. Для `saveDraft` достаточно изменённых полей. `applyAnswers` принимает массив `{field, value}`: `noConstraints` — boolean, `dataAvailability` — `available | none | unknown`, остальные поля — строки.

`workspace.task.version` защищает именно редактирование: новые отклики, выбор команды и события этапов её не меняют. Поэтому ввод бизнеса не конфликтует с действиями команд. `card.version` и версия события отражают всю активность задачи; их нельзя подставлять в `expectedVersion` редактора. Старая версия из другой вкладки редактора по-прежнему получает `409`.

## Разбор описания и ручное заполнение

`analyzeTask` — явное действие «Разобрать описание». Оно получает сохранённые `rawDescription` и поля, возвращает `workspace.analysis`, `quality` и обновлённую версию. Каждое предложение содержит `id`, `field`, `value`, `source: {id: 'rawDescription', quote}`. `value` равен точному непрерывному фрагменту исходного описания: модель не перефразирует его и не дописывает сведения. Предлагать можно только пустые текстовые поля; `dataAvailability` и `noConstraints` остаются ручным выбором. Цитата подтверждает источник, но человек проверяет её смысл и соответствие полю.

Покажите цитату рядом с полем и выбором пользователя. `applySuggestions` отправляет `{expectedVersion, analysisId, suggestionIds}` с ID из сохранённого ответа, без значений полей. Пустой `suggestionIds: []` отклоняет все; применение подмножества завершает весь анализ, оставшиеся предложения не применяются. Исправленный человеком текст сохраняйте через `saveDraft`. Автоматически применять все предложения нельзя. Применение обновляет только черновик и прогноз; официальный балл и опубликованные сведения меняются после обычного подтверждения человеком.

| `analysis.status` | Отображение и действие |
| --- | --- |
| `ready` | Предложения доступны для проверки; применять только при `canApply=true` |
| `empty` | Предложений нет; продолжить вручную или явно повторить разбор; показать `mode`/`warning` |
| `stale` | Сохранённые предложения относятся к прежней версии; применить нельзя, предложить новый анализ |
| `resolved` | Пользователь уже применил выбор или отклонил все; повторно эти ID не отправлять |

До первого анализа `analysis=null`. Анализ хранит `sourceVersion` и `applicableVersion`; сервер определяет применимость. После успешного разбора используйте **новую** `workspace.task.version` для применения. Любая последующая команда редактора, изменившая версию, делает неразрешённый анализ устаревшим. Активность команд в каталоге версию редактора не меняет.

`quality.warnings` — серверные рекомендации с `field`, `relatedFields`, `message`, `actionLabel`; `quality.nextAction` может вести к полю. Правила замечают известные общие фразы, один текст в трёх и более полях, сочетание «данных нет» с заполненным источником и «ограничений нет» с текстом ограничений. Это ограниченные объяснимые проверки: они не доказывают полноту смысла, не меняют формулу баллов и не блокируют публикацию. Покажите их рядом с полями, отдельно от `forecast` и `officialScore`.

## Ожидание AI, fallback и история

Запросы выполняются синхронно. Во время `analyzeTask`, `clarifyTask` или `submitEvidence` покажите локальное состояние ожидания и отключите повторную отправку той же операции. Сохраняйте набранный текст, разрешайте продолжить ручное заполнение. Не привязывайте доступность подтверждения или публикации к успеху AI; используйте серверные `actions`. Если пользователь сохраняет правки, пока AI работает, поздний результат может получить `409 STALE_VERSION` — это защита новых данных. Отмена запроса браузером не гарантирует отмену обработки на сервере; перед повтором перечитайте экран.

Лимит AI по умолчанию — 30 секунд, Git — 15 секунд. Отправка свидетельства последовательно включает Git и AI, поэтому может занять оба бюджета плюс сетевое время. Не показывайте фиктивный процент готовности. В `mode=stub` разбор возвращает пустой список, уточнение — шаблонные вопросы, проверка этапа — ручные проверки. Для разбора и уточнений показывайте `warning`, ручной путь и кнопку явного повтора. Отправленный этап остаётся `in_review` даже при fallback: результат сохранён, `reviewNotice` поясняет ручную проверку бизнесом. Не показывайте повторную отправку заблокированного этапа; она станет доступна после возврата на доработку. Клиент и SDK не делают автоматических платных повторов.

`workspace.aiRuns` содержит последние 20 завершённых запусков; SQLite удерживает до 100 на задачу. Журнал доступен только владельцу задачи, не каталогу и не другим командам. В записи есть операция, модель, версия prompt, длительность, usage, исходная версия, результат валидации и категория fallback. `disposition=applied` означает, что результат вызова сохранён, а `stale` — что его нельзя было применить к изменившемуся состоянию; это не решение пользователя по предложениям. Prompt, сырые ответы, секреты и внутренние рассуждения не записываются в этот журнал. Здесь нет статуса `in_progress`, очереди или возобновления прерванного процесса. Технические метаданные можно вынести в диагностику, не делая их обязательным шагом пользователя.

## Уточнения и каталог

Уточнения показывайте по одному через `clarification.nextQuestion`. AI выбирает поля для вопросов, сервер формирует нейтральный текст из своего каталога; произвольный вопрос модели пользователю не выводится. В ответе уже есть `field`, `text`, `index` (с 1), сохранённый `value`, тип `input` и `options` для списка. `progress` содержит `total`, `answered`, `skipped`, `remaining`; `questions` сохраняет весь список с признаками `answered` и `skipped`. После ответа замените workspace ответом сервера: следующий вопрос выбран автоматически. При повторном открытии вызывайте `workspace(id)`, не запускайте `clarifyTask` автоматически — это создание нового сеанса вопросов.

Сохранение любого поля не удаляет вопросы. Очищенный ответ снова становится незавершённым. «Данных нет» пропускает источник, отсутствие ограничений — вопрос об ограничениях; метрика с целью и условие приёмки заменяют друг друга. При удалении альтернативы вопрос возвращается. «Пока не знаю» считается ответом, но не добавляет баллы готовности за наличие сведений.

`nextAction.id=answer_question` означает продолжить текущий вопрос. После завершения вопросов предлагается проверить карточку. Можно подтвердить и неполную карточку — уточнения не являются барьером для публикации. `confirmTask` ставит `clarification.reviewed=true` и завершает текущий сеанс; новый явный `clarifyTask` снова открывает вопросы, даже если карточка уже опубликована. `questions` и прогресс остаются доступны для просмотра.

Каталог принимает `search`, `industry`, `level`, `page`, `pageSize`, `worldPage`. Карточки сортируются по официальному баллу; мир — стабильно по публикации, по пять станций с `slot` и `position`. `page` и `worldPage` независимы. `snapshot()` использует фильтры каталога по умолчанию, `dashboard: null` для гостя; текущий отфильтрованный каталог перезапросите отдельно.

На карточках и станциях `pendingMilestones > 0` включает маркер «На проверке»; `approvedMilestones` показывает подтверждённые этапы. В деталях `teamProgress` содержит `pendingStages`, `approvedStages`, `status` и готовый `statusLabel` для каждой выбранной команды. Ссылки, описания работы и замечания бизнеса здесь не публикуются. В приватном экране этапа используйте `statusLabel` и `statusHint`: команда видит ожидание проверки или просьбу исправить результат, бизнес — подсказку принятия решения. Очки появляются только после подтверждения.

## Сценарий кафе

Во вкладке бизнеса после `signIn`:

```ts
let workspace = (await api.startTask({
  rawDescription: 'Каждый вечер в кафе остаются непроданные блюда. Нужен прогноз закупок.',
  title: 'Снизить списания в кафе', industry: 'Общепит',
})).data;
const taskId = workspace.task.id;
workspace = (await api.analyzeTask(taskId, {
  expectedVersion: workspace.task.version,
})).data;
// Показать analysis.suggestions с цитатами. selectedSuggestionIds — выбор человека в UI.
const selectedSuggestionIds: string[] = []; // Пустой выбор означает «Продолжить без предложений».
if (workspace.analysis?.canApply) {
  workspace = (await api.applySuggestions(taskId, {
    expectedVersion: workspace.task.version,
    analysisId: workspace.analysis.id,
    suggestionIds: selectedSuggestionIds,
  })).data;
}
workspace = (await api.clarifyTask(taskId, {
  expectedVersion: workspace.task.version,
})).data;
// Показать workspace.clarification.nextQuestion; mode/warning честно сообщают режим AI.
workspace = (await api.applyAnswers(taskId, {
  expectedVersion: workspace.task.version,
  answers: [{ field: 'dataAvailability', value: 'available' }],
})).data;
workspace = (await api.saveDraft(taskId, {
  expectedVersion: workspace.task.version,
  fields: {
    need: 'Уменьшить списания готовой еды', users: 'Менеджеры кафе',
    dataSource: 'CSV продаж за три месяца', expectedResult: 'Прототип прогноза закупок',
    acceptanceCriteria: 'Загрузить CSV и показать прогноз по каждому блюду',
    constraints: 'Две недели, без персональных данных',
    contact: 'cafe@example.test', interactionFormat: 'Две консультации в неделю',
  },
})).data;
// Показать preview и forecast. Пользователь проверяет сведения и нажимает «Подтвердить».
workspace = (await api.confirmTask(taskId, { expectedVersion: workspace.task.version })).data;
workspace = (await api.publishTask(taskId, { expectedVersion: workspace.task.version })).data;
```

Во вкладке команды после входа своим кодом выберите опубликованную карточку через `catalog()`:

```ts
const catalog = (await api.catalog({ industry: 'Общепит' })).data;
const card = catalog.cards.find(card => card.title === 'Снизить списания в кафе');
if (!card) throw new Error('Выберите опубликованную задачу');
const taskId = card.id;
const detail = (await api.propose(taskId, {
  idea: 'Прогноз спроса по дням недели', plan: 'Проверим CSV, сравним базовые модели, проведём пилот',
  estimatedTime: 'Две недели', prototypeUrl: 'https://example.com/cafe-demo',
})).data;
// detail.myProposals — все отклики этой команды по задаче.
```

В `myProposals`, кабинете и review desk у каждого отклика есть `statusLabel` и `statusHint`. Для группы карточка содержит `participation`: состояние именно её работы и `nextAction` с `taskId`/`milestoneId`. У гостей и бизнеса `participation=null`; чужие частные сведения туда не попадают. Маршрутизация действий: `propose` открывает форму отклика, `open_dashboard` — кабинет команды, `create_milestone` — форму этапа указанной задачи, `open_milestone` — существующий этап по `milestoneId`. `selectedTasks[].nextAction` в кабинете использует тот же контракт. Можно предложить другой подход: наличие выбранного предложения не блокирует дополнительные отклики.

Если этап уже создан и отменён выбор последнего выбранного предложения этой команды, `participation.status=paused`, подпись этапа — «Работа приостановлена». Пока у команды остаётся другое выбранное предложение, работа продолжается. Материалы сохраняются, действия по сдаче/приёмке приостановленного этапа недоступны до повторного выбора. Кабинет бизнеса считает в `pendingReviews` только этапы выбранных команд; `pausedMilestones` показывает приостановленные отдельно. `tasks[].nextAction` ведёт сначала к результатам на проверке, затем к новым откликам и только после них к конструктору.

`milestone.reviewHistory` хранит до 20 последних решений бизнеса с `decision`, `feedback`, `decidedAt` и версией результата решения. Дата может быть `null` только у замечания из старой записи без известной даты; интерфейс не должен подставлять выдуманное время. `previousFeedback` сохраняет последние замечания после повторной сдачи; покажите их как «Последние замечания бизнеса», рядом с новой работой. `feedback` — текст текущего решения. История доступна только этой группе и владельцу задачи. Повторное подтверждение сообщает «Повторного начисления нет» и не создаёт ещё одну запись решения.

При возврате без объяснения сервер отвечает `422 FEEDBACK_REQUIRED`, `fieldErrors.feedback` и `recovery=correct_fields`: сохраните форму и подсветите поле замечаний. Название/отрасль допускают осмысленные короткие значения от двух символов, например `IT`; правила начисления баллов за описательные поля не меняются.

Бизнес выбирает нужный отклик из `reviewDesk(taskId)` и вызывает:

```ts
const desk = (await api.reviewDesk(taskId)).data;
const proposal = desk.proposals[0]; // В интерфейсе — выбранная пользователем строка.
if (!proposal) throw new Error('Пока нет откликов');
await api.decideProposal(proposal.id, {
  expectedVersion: proposal.version, decision: 'select', note: 'Начинаем пилот',
});
```

Выбранная команда создаёт этап и отправляет результат:

```ts
let stage = (await api.createMilestone(taskId, {
  title: 'Проверить прогноз', acceptanceCriteria: 'Прогноз по каждому блюду из тестового CSV',
})).data.milestone;
stage = (await api.submitEvidence(stage.id, {
  expectedVersion: stage.version,
  evidenceUrl: 'https://github.com/openai/openai-node', // Замените ссылкой на свои материалы.
  description: 'Добавили импорт CSV и демонстрацию прогноза',
})).data.milestone;
// stage.status === 'in_review'; очки ещё не начислены.
```

Бизнес открывает этот этап и принимает решение:

```ts
const stage = (await api.milestone(milestoneId)).data.milestone; // ID из reviewDesk.milestones.
const accepted = (await api.decideMilestone(stage.id, {
  expectedVersion: stage.version, decision: 'approve',
})).data.milestone;
const scoreboard = (await api.scoreboard()).data;
// Для возврата используйте decision: 'return' и непустой feedback.
```

Черновики недоступны гостю: для них `task(id)` возвращает 404, а владелец читает `workspace(id)`. Официальный балл меняется только при подтверждении, **может уменьшиться**; до него `forecast` — только прогноз. Название и отрасль также входят в подтверждённый снимок и не утекают из черновика. Низкий балл не блокирует публикацию и отклики. Можно отправлять несколько откликов и выбирать несколько команд. У каждой выбранной команды один этап на задачу. После подтверждения этап неизменяем; сервер начисляет ровно **10 очков один раз**. Git-факты и AI-комментарии не заменяют решение бизнеса; `mode`, `provider`, `status`, `warning` нужно показывать без подмены успешной проверкой.

## Материалы Git и цитаты критериев

Приватный экран этапа доступен его команде и владельцу задачи. `milestone.evidence.snapshot` может содержать `commitSha`, `inspectedAt`, `coverage`, `files` и `warnings`. Материал содержит `id`, `path`, `kind: readme|patch`, `sourceUrl`, `content`, `truncated`. README привязана к SHA через blob-ссылку, patch — к сравнению base SHA и head SHA, включая удалённые строки. Показывайте текст как недоверенное содержимое, без исполнения HTML или инструкций из него.

Выборка ограничена README и первой страницей patch PR: до 8 материалов, 6000 символов на материал, 24000 всего; каждый JSON-ответ GitHub ограничен 256 KiB. `coverage=complete` относится только к этой выборке, `partial` обозначает неполные/усечённые материалы, `metadata_only` — только метаданные. Это не аудит всего репозитория. Для repo/tree читается доступная README, а не весь исходный код. При изменении PR во время чтения или невозможности перепроверить его состояние материалы отбрасываются. Всегда показывайте `warnings` и `truncated`, даже при `status=verified`. Код и тесты репозитория сервер не запускает.

`milestone.review.criterionEvidence` связывает критерий с цитатами `{materialId, path, sourceUrl, quote}` и `nextStep`. Статус `materials_found` означает наличие выбранного фрагмента, `insufficient_evidence` — отсутствие полезной цитаты в оценённых материалах, `not_assessed` — критерий не был оценён при доступных материалах, например из-за fallback или лимита. За один живой вызов рассматривается до 12 критериев, выделенных из отдельных строк; остальные оставлены для человека. Цитаты дословно проверяются сервером, но README остаётся заявлением автора, patch — текстом изменений. Ни один статус не означает принятие или отклонение результата. Бизнес проверяет демонстрацию и принимает решение вручную; `approve` начисляет фиксированные 10 очков только один раз, `return` требует объяснение.

## Ошибки, отмена и повторение

Ошибка HTTP имеет `{error: {code, message, fieldErrors, recovery}, meta}`. Клиент выбрасывает `ApiError` с теми же полями, плюс `status`, `requestId`, `idempotencyKey`. Для транспорта: `status: 0`, `code: NETWORK_ERROR` или `REQUEST_ABORTED`; непонятный успешный ответ — `INVALID_RESPONSE`. Все методы принимают последним аргументом `{signal}` для `AbortController`.

```ts
try {
  await api.saveDraft(taskId, { expectedVersion: 1, fields: { title: 'Новое название' } });
} catch (error) {
  if (!(error instanceof ApiError)) throw error;
  if (error.code === 'STALE_VERSION') {
    const latest = (await api.workspace(taskId)).data;
    // Сохраните локальные правки, покажите конфликт и дайте применить их к latest.task.version.
  }
  // error.fieldErrors['fields.title'], error.fieldErrors.title и _form — ошибки полей/формы.
  // При SESSION_EXPIRED очистите токен и верните форму входа.
  // error.message — текст пользователю; error.requestId — диагностика.
}
```

`startTask`, `propose`, `createMilestone` автоматически ставят случайный `Idempotency-Key`. Для управляемого повторения сохраните ключ **до отправки**, например в состоянии формы; повторяйте то же тело с тем же ключом. При ошибке с автоматически созданным ключом он доступен в `error.idempotencyKey`. Повторный вызов без передачи ключа означает новое действие.

```ts
const idempotencyKey = crypto.randomUUID();
const input = { rawDescription: 'Сократить списания в кафе' };
const send = () => api.startTask(input, { idempotencyKey });
// await send(); при потере ответа повторный send() вернёт ту же задачу.
```

На `409 IDEMPOTENCY_CONFLICT` нельзя повторять изменённое тело прежним ключом. Ключи не нужны обычному сохранению: его защищает `expectedVersion`. Не перезаписывайте чужие изменения автоматическим retry на `STALE_VERSION`.

Для предложений при `409 ANALYSIS_STALE` (`recovery: 'reanalyze'`) перечитайте workspace, сохраните локальный ввод и предложите явный новый разбор или ручное заполнение. Не подставляйте новую версию в старый `analysisId` автоматически. `409 FIELD_ALREADY_FILLED` также требует перечитать данные и сохранить уже заполненное поле. `422 INVALID_SUGGESTIONS` означает неизвестные или повторяющиеся ID: восстановите выбор из текущего анализа. После сетевой ошибки AI-операции сначала загрузите workspace/этап: сервер мог уже сохранить результат, даже если браузер его не получил. Повтор анализа требует отдельного действия пользователя.

## Realtime и восстановление

Для realtime установите `socket.io-client` в проекте фронтенда. Подключение идёт к **origin**, не `/api/v1`, путь `/socket.io`. Токен передаётся в `auth.token`; гостю он не нужен. После входа/выхода переподключите сокет, чтобы права соответствовали текущей вкладке.

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001', {
  path: '/socket.io',
  auth: done => {
    const token = sessionStorage.getItem('sana.token');
    done(token ? { token } : {});
  },
});

let pending: ReturnType<typeof setTimeout> | undefined;
function scheduleRefetch() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    void api.snapshot().then(({ data }) => {
      // Замените кеш основных экранов на data.
      // Открытый workspace/review/task/milestone и каталог с фильтрами загрузите отдельно.
    }).catch(error => {
      // Покажите ошибку связи или форму входа при SESSION_EXPIRED.
      console.error(error);
    });
  }, 50);
}
socket.on('connect', scheduleRefetch);
socket.on('sync.required', scheduleRefetch);
socket.on('invalidate', (event: InvalidationEvent) => {
  // event.invalidate — ключи кеша; event.taskId/entityId помогают обновить открытый экран.
  scheduleRefetch();
});
// После signIn или signOut: socket.disconnect().connect().
// При размонтировании: socket.disconnect(); clearTimeout(pending).
```

`invalidate` содержит **только** `{type, taskId, entityId, version, invalidate}`. Для событий задачи `version` — общая ревизия активности; перед командой загрузите версию редактора, отклика или этапа через HTTP. `team.created` обновляет `scoreboard`, имеет `taskId: null`, `entityId` команды и `version: 1`; не открывайте задачу для такого события. Код входа и токен в событие не попадают. События этапов включают ключ `milestone`, чтобы обновить открытый экран результата. Отправка на проверку и возврат на доработку публично обновляют маркеры каталога без передачи содержания материалов.

`sync.required` сообщает `{reason: 'connected', refetch: ['bootstrap','catalog','dashboard','scoreboard']}`. События не являются журналом: сообщения во время разрыва могут потеряться. Поэтому каждый `connect` и `sync.required` запускают чтение снимка, а открытый детальный экран обновляется отдельно. Для черновиков события получают только владельцы; гостям идут публичные инвалидации. Реальные данные всегда загружаются через авторизованный HTTP. При обновлении экрана сохраняйте ещё не отправленный локальный ввод формы; сетевое событие не должно стирать то, что человек печатает.

## Проверка интеграции

Из `backend/`: `npm run check`, `npm test`, `npm run build`, `npm run demo`. `npm run preflight` проверяет доступность модели и публичных repo/PR; `npm run demo -- --live` проходит HTTP-сценарий с живыми провайдерами во временной БД. Для eval: `npm run eval` — stub-контракт, `npm run eval -- --live --repeat=3` — платная живая серия. Сценарии лежат в [backend/scripts/eval-cases.ts](../backend/scripts/eval-cases.ts), отчёты — в `docs/evals/`.

23 сентября 2026 живая проверка подключения модели/repo/PR и HTTP demo прошли; публичный GitHub работал без токена. Demo подтвердил Luna, цитаты материалов, три записи истории и команду подтверждения от бизнеса: 10 очков без повторного начисления. Решение пользователя имитировал smoke-скрипт. [Отчёт живой серии](evals/live-harness-report.json): 45/45 проверок на 15 синтетических сценариях, без fallback, p95 4853 мс. Это ограниченная регрессия извлечения полей, а не доказательство полной смысловой корректности, готовности интерфейса или 3D. Правила запуска и границы backend — в [backend/README.md](../backend/README.md); архитектурные решения — в [дизайне harness](superpowers/specs/2026-09-23-agent-harness-design.md).
