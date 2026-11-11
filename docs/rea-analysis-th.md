# ผลวิเคราะห์ OpenWorksheets ด้วย REA

วิเคราะห์เมื่อ 11 พ.ย. 2026 ด้วยคำสั่ง

```bash
npx -y rea-agents@latest analyze-javascript-application <โฟลเดอร์ openworksheets> --json
```

REA (Reverse Engineer Anything, github.com/morluto/rea) อ่านโค้ด JavaScript ทั้งแอปแบบ static แล้วสร้างกราฟความสัมพันธ์ของโมดูลพร้อมหลักฐาน ผลลัพธ์ JSON มีขนาดประมาณ 200 MB จึงไม่ได้เก็บไว้ในโปรเจกต์ เอกสารนี้สรุปเฉพาะส่วนที่ใช้ตัดสินใจตอนทำฉบับภาษาไทย

## สถิติจาก REA

| รายการ | ค่า |
|---|---|
| ไฟล์ที่เกี่ยวข้อง | 97 |
| ไฟล์ JavaScript ที่ parse ได้ | 77 (ล้มเหลว 0) |
| โมดูล | 481 |
| โหนด AST ที่ตรวจ | 1,425,474 |
| ความสัมพันธ์ `imports` | 1,081 |
| ความสัมพันธ์ `calls` | 956 |
| การเขียนลงที่เก็บข้อมูล (`persists_to`) | 42 |
| Service worker / worker | 1 / 1 (SCORM และ pdf.js) |

ไม่พบ Electron, IPC หรือ native addon แปลว่าเป็นเว็บแอปฝั่งเบราว์เซอร์ล้วน ไม่มีเซิร์ฟเวอร์ของตัวเอง

## กราฟการ import ระหว่างโมดูล (จาก REA)

| โมดูล | import |
|---|---|
| js/editor.js | aiimport, aiui, drive, editor-state, editor-ui, fieldtypes, filehandoff, fonts, grading, **i18n**, icons, imscpexport, markdown, mathrender, mcpui, pdfimport, player, render, scorm, scormexport, scormhost, submissionCrypto, util, webexport, zipio |
| js/player.js | entrega, fieldtypes, fonts, grading, **i18n**, icons, mathrender, render, scormhost, submissionCrypto, util |
| js/render.js | edicuatex, fieldtypes, fonts, **i18n**, icons, markdown, mathrender, scorm, util |
| js/alumno.js | alumno-cache, download, drive, **i18n**, player, submissionCrypto, util, zipio |
| js/grading.js | fieldtypes, scorm, util |
| js/entregas.js | classview, entrega, **i18n**, submissionCrypto, util, verifyview |
| js/aiimport.js | fieldtypes, **i18n**, util |
| js/fieldtypes.js | **i18n**, icons |
| js/zipio.js | **i18n** |
| js/index.js | drive, **i18n**, mathrender, util |

(ตัดแถวที่ซ้ำรูปแบบออก ได้แก่ aiui, classview, drive, editor-state, editor-ui, entrega, imscpexport, mcpui, pdfimport, sco, scormexport, verifyview, webexport, webrun และ caracteristicas)

## ที่เก็บข้อมูลในเบราว์เซอร์ที่ REA พบ

`localStorage`: `wpf-lang` (ภาษา), `wpf-tema` (ธีม), `wpf-ed-zoom`, `ows.editorPanelWidth`, `ows.editorThumbsWidth`, `ows.pageSizeUnit`
นอกจากนี้ยังมี `sessionStorage`, `indexedDB` (แคชใบงานของนักเรียน) และ `caches` (service worker ของ SCORM)

## ข้อสรุปที่ใช้ตอนทำฉบับภาษาไทย

1. **ข้อความทั้งหมดผ่าน `js/i18n.js` ที่เดียว** เกือบทุกโมดูลที่แสดง UI import i18n ดังนั้นการเพิ่มภาษาไทยทำได้โดยเพิ่มชุดข้อความ `th` (`js/i18n-th.js`, 1,005 ข้อความ) ไม่ต้องรื้อโมดูลอื่น
2. **การตรวจคำตอบอยู่ที่ `util.normalizeText` ← `grading.js`/`render.js`** จึงแก้ที่จุดเดียวเพื่อรองรับภาษาไทย (ไม่สนใจช่องว่างระหว่างคำไทย ตัดอักขระความกว้างศูนย์ ถือว่า «ํา» = «ำ»)
3. **ฟอนต์มาจาก `fonts.js` + `@font-face` ใน `css/app.css`** และ `fontFilesFor()` เป็นตัวเลือกไฟล์ฟอนต์ที่จะใส่ในแพ็กเกจส่งออก จึงเพิ่ม Sarabun / Noto Sans Thai Looped ไว้ที่นี่เพื่อให้ใบงานที่ส่งออก (SCORM, เว็บ, IMS CP) แสดงภาษาไทยได้ด้วย
4. **ค่าเริ่มต้นของช่องบางตัวเขียนเป็นภาษาสเปนตายตัว** (`fieldtypes.js`, `editor.js`, `aiimport.js`, `grading.js` เช่น «Verdadero/Falso», «Opción 1») ซึ่งไม่ผ่าน i18n จึงแก้เป็นภาษาไทยโดยตรง
5. **ตัวนับคำของคำตอบยาว (`render.js`) นับตามช่องว่าง** ใช้กับภาษาไทยไม่ได้ จึงเปลี่ยนไปใช้ `Intl.Segmenter('th')` เมื่อข้อความมีอักษรไทย
