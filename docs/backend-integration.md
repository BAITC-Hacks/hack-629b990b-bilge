# Подключение фронтенда к AI Sana

База HTTP: `http://localhost:3001/api/v1`. Swagger: `http://localhost:3001/api/docs`, JSON OpenAPI 3.1: `http://localhost:3001/api/openapi.json`. Схемы команд генерируются из тех же Zod-валидаторов, которыми сервер проверяет запросы. Браузерный клиент — `backend/client/index.ts`: runtime-зависимостей на сервер, SQLite и Node.js нет, импорты серверных типов стираются при сборке.

Из `backend/`: `npm install`, `npm run seed`, `npm run dev`. Коды подготовленных профилей находятся в **локальном** `backend/demo-accounts.local.json`; seed создаёт случайные коды и не публикует их в репозитории. Сервер также запускает seed при старте. Разрешённые адреса фронтенда задаются в `ALLOWED_ORIGINS`; по умолчанию это `http://localhost:5173` и `http://127.0.0.1:5173`.

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

Пример сокращён; полные типы экспортируются клиентом. `data` — готовая модель экрана BFF, а не строка таблицы. Команда возвращает обновлённый экран: заменяйте соответствующий кеш её `data`, показывайте `feedback?.message`. Чтение обычно возвращает `feedback: null`. `actions[].enabled/reason`, `nextAction`, `emptyState`, подписи полей и шаги уже подготовлены сервером. При этом сервер заново проверяет разрешения каждой команды.

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

Уточнения показывайте по одному через `clarification.nextQuestion`. В нём уже есть `field`, `text`, `index` (с 1), сохранённый `value`, тип `input` и `options` для списка. `progress` содержит `total`, `answered`, `skipped`, `remaining`; `questions` сохраняет весь список с признаками `answered` и `skipped`. После ответа замените workspace ответом сервера: следующий вопрос выбран автоматически. При повторном открытии вызывайте `workspace(id)`, не запускайте `clarifyTask` автоматически — это создание нового сеанса вопросов.

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
