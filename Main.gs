/** * TADO DATA SYNC - UNIFIED SHEET VERSION **/
const CONFIG = {
  HOME_ID: XXXXX, // PUT YOUR HOME_ID FROM AUTH_SCRIPT
  ZONE_ID: 1,
  ZONE_NAME: "Salón",
  CLIENT_ID: "1bb50063-6b0c-4d11-bd99-387f4a91cc46",
  INITIAL_REFRESH_TOKEN: "CHANGE_FOR_THE_ONE_FROM_AUHT_SCRIPT", 
   
  HISTORY_LIMIT_DATE: "2024-01-28",
  DAYS_PER_HISTORY_BATCH: 15, // ANYTHING FROM 10-30
  TIMEZONE: "GMT+1",
  DATE_FORMAT: "yyyy-MM-dd",
  TIME_FORMAT: "HH:mm:ss"
};

/**
 * DAILY AUTOMATION
 */
function dailySync() {
  const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
  const dateStr = Utilities.formatDate(yesterday, CONFIG.TIMEZONE, CONFIG.DATE_FORMAT);
  console.log("Iniciando dailySync para la fecha: " + dateStr); // <--- AÑADIR ESTO
  processAndSave(dateStr, "TOP");
}


/**
 * HISTORICAL RECOVERY
 */
function historicalSync() {
  const props = PropertiesService.getScriptProperties();
  let lastDate = props.getProperty("LAST_RECOVERED_DATE") || 
                 Utilities.formatDate(new Date(new Date().getTime() - 2 * 24 * 60 * 60 * 1000), CONFIG.TIMEZONE, CONFIG.DATE_FORMAT);

  let currentDate = new Date(lastDate);
  let limitDate = new Date(CONFIG.HISTORY_LIMIT_DATE);

  for (let i = 0; i < CONFIG.DAYS_PER_HISTORY_BATCH; i++) {
    if (currentDate < limitDate) break;
    let fStr = Utilities.formatDate(currentDate, CONFIG.TIMEZONE, CONFIG.DATE_FORMAT);
    processAndSave(fStr, "BOTTOM");
    currentDate.setDate(currentDate.getDate() - 1);
    props.setProperty("LAST_RECOVERED_DATE", Utilities.formatDate(currentDate, CONFIG.TIMEZONE, CONFIG.DATE_FORMAT));
    Utilities.sleep(1500); 
  }
}

/**
 * CORE PROCESSING LOGIC
 */
/**
 * UPDATED CORE PROCESSING LOGIC (With Boundary Filtering)
 */
function processAndSave(dateStr, mode) {
  // USAMOS TU FUNCIÓN REAL: getAccessToken
  const token = getAccessToken();
  
  // Llamada a fetchTadoData con la fecha y el token [cite: 10, 40]
  const data = fetchTadoData(dateStr, token);
  if (!data) return; 

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const temps = data.measuredData?.insideTemperature?.dataPoints || []; 
  const hums = data.measuredData?.humidity?.dataPoints || []; 
  const settings = data.settings?.dataIntervals || []; 
  const heat = data.callForHeat?.dataIntervals || []; 
  const weather = data.weather?.condition?.dataIntervals || []; 
  const solar = data.weather?.solarIntensity?.dataPoints || []; 
  
  const toMs = (iso) => new Date(iso).getTime();
  const currentProcessingDate = new Date(dateStr).toDateString(); 

  // 1. GENERATE MASTER SHEET
  const unifiedRows = temps
    .filter(p => new Date(p.timestamp).toDateString() === currentProcessingDate)
    .map(p => {
      const pMs = toMs(p.timestamp);
      const time = Utilities.formatDate(new Date(pMs), CONFIG.TIMEZONE, CONFIG.TIME_FORMAT);
      
      const hM = hums.reduce((prev, curr) => Math.abs(toMs(curr.timestamp)-pMs) < Math.abs(toMs(prev.timestamp)-pMs) ? curr : prev, hums[0]);
      const sM = settings.find(s => pMs >= toMs(s.from) && pMs < toMs(s.to));
      const heatM = heat.find(h => pMs >= toMs(h.from) && pMs < toMs(h.to)); 
      const wM = weather.find(w => pMs >= toMs(w.from) && pMs < toMs(w.to));
      const solarM = solar.reduce((prev, curr) => Math.abs(toMs(curr.timestamp)-pMs) < Math.abs(toMs(prev.timestamp)-pMs) ? curr : prev, solar[0]);

      return [
        CONFIG.ZONE_ID, CONFIG.ZONE_NAME, dateStr, time, 
        p.value.celsius, hM ? (hM.value * 100).toFixed(1) : "N/A",
        sM ? (sM.value.temperature?.celsius || "OFF") : "N/A", 
        heatM ? heatM.value : "NONE",
        wM ? wM.value.temperature.celsius : "N/A", 
        solarM ? solarM.value.percentage + "%" : "0%", 
        wM ? wM.value.state : "N/A", 
        mode
      ];
    });
  saveToSheet(ss, "Measured Data", ["ZONE ID", "ZONE NAME", "DATE", "TIME", "TEMP (C)", "HUM %", "SETPOINT", "HEATING", "EXT TEMP", "SOLAR %", "WEATHER", "SOURCE"], unifiedRows);

  const filterInterval = (item) => new Date(item.from).toDateString() === currentProcessingDate; 

  // 2. SETTINGS (Fechas formateadas)
  const settingsRows = settings.filter(filterInterval).map(s => [
    CONFIG.ZONE_ID, CONFIG.ZONE_NAME, formatTadoDate(s.from), formatTadoDate(s.to), s.value.type, s.value.temperature?.celsius || "OFF", mode 
  ]);
  saveToSheet(ss, "Settings", ["ZONE ID", "ZONE NAME", "FROM", "TO", "TYPE", "SETPOINT", "SOURCE"], settingsRows); 

  // 3. CALL FOR HEAT (Fechas formateadas)
  const callForHeatRows = heat.filter(filterInterval).map(h => [
    CONFIG.ZONE_ID, CONFIG.ZONE_NAME, formatTadoDate(h.from), formatTadoDate(h.to), h.value, mode  ]);
  saveToSheet(ss, "Call For Heat", ["ZONE ID", "ZONE NAME", "FROM", "TO", "DEMAND", "SOURCE"], callForHeatRows); 

  // 4. WEATHER (6 Columnas, sin la columna DATE inicial redundante)
  const weatherRows = weather.filter(filterInterval).map(w => {
    const wMs = toMs(w.from);
    const sMatch = solar.reduce((prev, curr) => Math.abs(toMs(curr.timestamp)-wMs) < Math.abs(toMs(prev.timestamp)-pMs) ? curr : prev, solar[0]);
    return [
      formatTadoDate(w.from), // Col A: FROM limpio
      formatTadoDate(w.to),   // Col B: TO limpio
      w.value.state, 
      w.value.temperature.celsius, 
      sMatch ? sMatch.value.percentage + "%" : "0%", 
      mode
    ]; 
  });
  saveToSheet(ss, "Weather", ["FROM", "TO", "STATE", "OUTSIDE TEMP", "SOLAR %", "SOURCE"], weatherRows); 
}


/** --- UTILS --- **/

function saveToSheet(ss, name, headers, newRows) {
  if (newRows.length === 0) return;
  let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  const lastRow = sheet.getLastRow();
  let filteredRows = newRows;

  if (lastRow > 1) {
    // Weather usa Col 1 (FROM) para duplicados, las demás la Col 3 (DATE/FROM)
    const checkCol = (name === "Weather") ? 1 : 3;
    const existingData = sheet.getRange(2, checkCol, lastRow - 1, 1).getValues();
    const existingKeys = new Set(existingData.map(r => String(r[0])));
    filteredRows = newRows.filter(r => !existingKeys.has(String(r[checkCol - 1])));
  }

  if (filteredRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, filteredRows.length, filteredRows[0].length).setValues(filteredRows);
    
    // Ordenar: Más nuevo arriba (Descendente)
    let sortCriteria = [];
    if (name === "Measured Data") {
      sortCriteria = [{column: 3, ascending: false}, {column: 4, ascending: false}];
    } else {
      const sortCol = (name === "Weather") ? 1 : 3;
      sortCriteria = [{column: sortCol, ascending: false}];
    }
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort(sortCriteria);
  }
}

function fetchTadoData(dateStr, token) {
  const url = `https://my.tado.com/api/v2/homes/${CONFIG.HOME_ID}/zones/${CONFIG.ZONE_ID}/dayReport?date=${dateStr}`;
  const response = UrlFetchApp.fetch(url, {"headers": {"Authorization": "Bearer " + token}, "muteHttpExceptions": true});
  return response.getResponseCode() === 200 ? JSON.parse(response.getContentText()) : null;
}

function getAccessToken() {
  const props = PropertiesService.getScriptProperties();
  let refreshToken = props.getProperty('REFRESH_TOKEN') || CONFIG.INITIAL_REFRESH_TOKEN;
  if (!refreshToken || refreshToken === "YOUR_REFRESH_TOKEN_HERE") throw new Error("Check Refresh Token.");
  const payload = {"client_id": CONFIG.CLIENT_ID, "grant_type": "refresh_token", "refresh_token": refreshToken};
  const response = UrlFetchApp.fetch("https://login.tado.com/oauth2/token", {"method": "post", "payload": payload, "muteHttpExceptions": true});
  const data = JSON.parse(response.getContentText());
  if (data.access_token) {
    if (data.refresh_token) props.setProperty('REFRESH_TOKEN', data.refresh_token);
    return data.access_token;
  }
  throw new Error("Auth Error: " + response.getContentText());
}

function resetHistoryProgress() {
  PropertiesService.getScriptProperties().deleteProperty("LAST_RECOVERED_DATE");
  console.log("✅ History progress has been reset. Next run will start from your current target date.");
}




function formatTadoDate(isoString) {
  if (!isoString || isoString === "") return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString; 
  return Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

function filterInterval(interval) {
  return interval && interval.from && interval.to;
}





/**
 * --- UNIVERSAL CLEANUP TOOLS WITH DETAILED LOGGING AND CELL REFERENCES ---
 */

function cleanAllSheetsDryRun() {
  runUniversalCleanup(true);
}

function cleanAllSheetsEffective() {
  runUniversalCleanup(false);
}

/**
 * --- UNIVERSAL CLEANUP TOOLS (VERSION CON LOGS DE FILA DETALLADOS) ---
 */

function runUniversalCleanup(isDryRun) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetsConfig = [
    // CONFIGURACIÓN PARA EL PRIMER CASO: FECHA > HORA
    { name: "Measured Data", keyCols: [2, 3], sortCols: [{col: 3, asc: false}, {col: 4, asc: false}] },
    { name: "Settings",      keyCols: [2, 3], sortCols: [{col: 3, asc: false}, {col: 4, asc: false}] },
    { name: "Call For Heat", keyCols: [2, 3], sortCols: [{col: 3, asc: false}, {col: 4, asc: false}] },
    { name: "Weather",       keyCols: [1, 2], sortCols: [{col: 2, asc: false}, {col: 3, asc: false}] }
  ];

  sheetsConfig.forEach(conf => {
    const sheet = ss.getSheetByName(conf.name);
    if (!sheet) return;

    const range = sheet.getDataRange();
    const fullData = range.getValues();
    if (fullData.length <= 1) return;

    const headers = fullData[0];
    const dataRows = fullData.slice(1);
    
    const seenKeys = new Map();
    const uniqueRows = [];
    const duplicatesLog = {};

    dataRows.forEach((row, index) => {
      const currentRowNum = index + 2;
      
      const keyParts = conf.keyCols.map(idx => {
        let val = row[idx];
        if (val instanceof Date) {
          let format = (idx === 2 || (conf.name === "Weather" && idx === 1)) ? "yyyy-MM-dd" : "HH:mm:ss";
          return Utilities.formatDate(val, CONFIG.TIMEZONE, format);
        }
        return String(val).trim(); 
      });
      
      const key = keyParts.join(" | ");

      if (!key || key === " | ") {
        uniqueRows.push(row);
        return;
      }

      if (!seenKeys.has(key)) {
        seenKeys.set(key, currentRowNum);
        uniqueRows.push(row);
      } else {
        if (!duplicatesLog[key]) {
          duplicatesLog[key] = { kept: seenKeys.get(key), removed: [] };
        }
        duplicatesLog[key].removed.push(currentRowNum);
      }
    });

    if (!isDryRun && uniqueRows.length > 0) {
      sheet.clear(); 
      const finalOutput = [headers, ...uniqueRows];
      sheet.getRange(1, 1, finalOutput.length, headers.length).setValues(finalOutput);
      
      // APLICACIÓN DEL ORDENADO CORRECTO
      const sortCriteria = conf.sortCols.map(s => ({column: s.col + 1, ascending: s.asc}));
      sheet.getRange(2, 1, uniqueRows.length, headers.length).sort(sortCriteria);
      
      console.log(`✅ [${conf.name}] Ordenada por Día y luego por Hora.`);
    }
  });
}
