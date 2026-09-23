# Промпты для 3D-моделей «Площади задач»

Сейчас все модели собраны в коде из примитивов (`src/world/Pavilion.tsx`, `Avatar.tsx`, `Environment.tsx`) и работают без ассетов. Промпты ниже нужны, чтобы сгенерировать красивые GLB в text-to-3D сервисах (Meshy, Tripo, Rodin/Hyper3D, Luma Genie и т. п.) или отдать задание 3D-художнику. Процедурные модели при этом остаются запасным вариантом.

## Общие требования ко всем моделям (добавлять к каждому промпту)
- Стиль: **stylized low-poly, soft pastel colors, clean flat shading, friendly, calm** (без реализма, без агрессивных бликов и неона).
- Формат: **GLB (glTF 2.0)**, все текстуры и материалы внутри файла, без внешних путей.
- Масштаб: **1 unit = 1 метр**. Точка опоры (pivot) — **центр основания на полу (Y = 0)**. Вперёд смотрит **+Z**.
- Бюджет: павильон ≤ 15 тыс. треугольников и ≤ 2 МБ, аватар ≤ 8 тыс. треугольников и ≤ 1 МБ, окружение целиком ≤ 5 МБ. Площадь с 5 павильонами — до ~60 тыс. треугольников.
- Текстуры: не больше 1024×1024, PBR-материалы (baseColor, roughness). Без анимированных материалов.
- **Никаких надписей и цифр на текстурах**: названия, баллы и кнопки рисуются HTML поверх сцены.
- Проверять импорт в браузере (https://gltf-viewer.donmccurdy.com/), а не только в Blender.

## 1. Павильон задачи — `station.glb` (главная модель, используется для всех задач)
**Промпт:**
> Stylized low-poly hexagonal pavilion kiosk for a friendly city plaza, open sides with six slim white columns, hexagonal stone base with one step, soft pastel hexagonal roof, a transparent glass cylinder in the center of the pavilion standing on the floor, empty space around the glass cylinder, clean flat shading, calm pastel palette, game-ready, no text, no logos, centered on origin, base on the ground.

**Обязательные узлы (имена объектов в Blender → узлы в GLB):**
| Имя узла | Что это | Требование |
|---|---|---|
| `Core_Fill` | цилиндр внутри стеклянной колонны | Отдельный меш, pivot **внизу**, высота ровно 1 м при scale Y = 1 — фронтенд растягивает его по Y по рейтингу. Отдельный материал (бирюзовый #14B8A6). |
| `Beacon` | вертикальный световой луч над крышей | Отдельный меш, открытый конус/цилиндр, материал полупрозрачный. Фронтенд включает от 70 баллов. |
| `Ring_Approved` | кольцо вокруг основания из **5 отдельных сегментов** `Ring_Approved_0` … `Ring_Approved_4` | Каждый сегмент — отдельный меш с отдельным материалом, фронтенд красит заполненные сегменты янтарным #F59E0B. |
| `Anchor_Label` | пустой объект (Empty) над крышей | Точка для HTML-подписи, примерно на 1 м выше крыши. |
| `Anchor_Interact` | пустой объект или невидимый цилиндр по габариту павильона | Зона клика. |
| `Roof` | крыша | Отдельный материал — фронтенд подкрашивает по отрасли задачи. |

Габарит: диаметр основания около 6.5 м, высота до верха крыши около 5 м, стеклянная колонна радиусом ≈ 0.85 м и высотой ≈ 2.6 м.

## 2. Аватары команд — `avatar_<preset>.glb` (5 готовых пресетов, без фото и лиц реальных людей)
**Общий промпт (подставить вариант):**
> Cute stylized low-poly chibi character, full body, standing in T-pose, big head, simple face with dot eyes, [ВАРИАНТ], neutral body color that can be tinted, clean flat shading, game-ready, no text, no logos, feet on the ground at origin, facing forward.

Варианты:
- `explorer` — explorer with a wide-brim safari hat and a small backpack
- `robot` — friendly boxy robot with a screen face and a short antenna
- `astronaut` — astronaut in a white suit with a round transparent helmet and a backpack
- `ninja` — ninja in a dark suit with a headband and a face mask
- `wizard` — young wizard in a long robe and a tall pointed hat with a star

**Требования:** рост ≈ 2.2 м; один материал `TeamColor` (фронтенд красит его в цвет команды); скелет с костями `Hips`, `LeftUpLeg`, `RightUpLeg`, `LeftArm`, `RightArm`, `Head` **или** отдельные меши `Leg_L`, `Leg_R`, `Arm_L`, `Arm_R` с pivot в суставе — для анимации шага. Если сервис умеет — анимации `Idle` и `Walk` (in-place, без смещения корня).

## 3. Жетон команды — `team_token.glb`
> Stylized low-poly round team token on a thin metal post, like a small signpost with a flat disc on top, clean flat shading, no text, no logos, base on the ground.

Узел `Token_Disc` — отдельный материал (фронтенд красит в цвет команды). Высота ≈ 1.6 м.

## 4. Окружение площади — `world.glb` (по желанию, можно частями)
> Stylized low-poly circular town plaza, light beige stone pavement with two subtle concentric ring patterns, a round fountain with a small bowl in the center, low-poly trees (pines and round trees) around the edge, park benches, simple street lamps, a paved path leading south to an entrance arch, calm pastel colors, soft daylight, clean flat shading, game-ready, no text, no logos.

**Требования:** радиус мощёной площади ≈ 22 м, центр фонтана в (0, 0, 0), вход (арка) на юге около Z = +26. **Пустые места** под павильоны: 5 точек на окружности радиуса 11 м, первая строго на севере (−Z), далее через каждые 72°; в радиусе 4.5 м от каждой точки ничего не ставить. Отдельные узлы: `Fountain`, `Arch`, `Board` (доска таблицы команд, около X = −13, Z = +15), `Kiosk` (киоск «Все задачи», около X = +13, Z = +15).

## Как подключить готовые GLB
1. Положить файлы в `platform/public/models/`.
2. В `Pavilion.tsx` загрузить `useGLTF('/models/station.glb')` и клонировать сцену на каждый павильон; найти узлы по именам из таблицы и управлять ими так же, как сейчас процедурными (`Core_Fill.scale.y`, видимость `Beacon`, цвет сегментов `Ring_Approved_i`).
3. Если загрузка GLB упала, оставить процедурную модель (ТЗ 2.1 и 5.3: при проблеме с ассетом — простая геометрия).
