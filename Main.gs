/** * TADO DATA SYNC - UNIFIED SHEET VERSION **/
const CONFIG = {
  HOME_ID: 1111111, // PUT YOUR OWN ID FROM Auth.gs
  ZONE_ID: 1, // ONLY 1 ZONE FOR THE TIME BEING
  ZONE_NAME: "Salón", // FILL WITH YOUR ZONE NAME
  CLIENT_ID: "1bb50063-6b0c-4d11-bd99-387f4a91cc46",
  INITIAL_REFRESH_TOKEN: "FILL_WITH_YOUR_REFRESH_TOKEN_FROM_Auth.gs",
  
  HISTORY_LIMIT_DATE: "2024-01-28",
  DAYS_PER_HISTORY_BATCH: 15, // RECOMMENDED BETWEEN 7 - 20 
  TIMEZONE: "GMT+1",
  DATE_FORMAT: "yyyy-MM-dd",
  TIME_FORMAT: "HH:mm:ss"
};


const CONFIG = {
  HOME_ID: 1475261,
  ZONE_ID: 1,
  ZONE_NAME: "Salón",
  CLIENT_ID: "1bb50063-6b0c-4d11-bd99-387f4a91cc46",
  INITIAL_REFRESH_TOKEN: "uhwFWomaDQCGWEto6Z8FAMGqvdD2iHQ_BtHqZHjyP1gUbbtv33InRMvbRD1T6OST", // Cámbialo por el que obtuviste
   
  HISTORY_LIMIT_DATE: "2024-01-28",
  DAYS_PER_HISTORY_BATCH: 15, 
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
function processAndSave(dateStr, mode) {
  const token = getAccessToken();
  const data = fetchTadoData(dateStr, token);
  if (!data) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // --- 1. PREPARE DATA FOR MAPPING ---
  const temps = data.measuredData?.insideTemperature?.dataPoints || [];
  const hums = data.measuredData?.humidity?.dataPoints || [];
  const settings = data.settings?.dataIntervals || [];
  const heat = data.callForHeat?.dataIntervals || [];
  const weather = data.weather?.condition?.dataIntervals || [];
  const solar = data.weather?.solarIntensity?.dataPoints || [];
  const toMs = (iso) => new Date(iso).getTime();

  // --- 2. GENERATE MASTER SHEET (MEASURED DATA UNIFIED) ---
  const unifiedRows = temps.map(p => {
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
      wM ? wM.value.state : "N/A", mode
    ];
  });
  
  const masterHeaders = ["ZONE ID", "ZONE NAME", "DATE", "TIME", "TEMP (C)", "HUM %", "SETPOINT", "HEATING", "EXT TEMP", "SOLAR %", "WEATHER", "SOURCE"];
  saveToSheet(ss, "Measured Data", masterHeaders, unifiedRows, mode);

  // --- 3. GENERATE INTERVAL SHEETS (INDIVIDUAL) ---
  
  // SETTINGS SHEET
  const settingsRows = settings.map(s => [
    CONFIG.ZONE_ID, CONFIG.ZONE_NAME, s.from, s.to, s.value.type, s.value.temperature?.celsius || "OFF", mode
  ]);
  saveToSheet(ss, "Settings", ["ZONE ID", "ZONE NAME", "FROM", "TO", "TYPE", "SETPOINT", "SOURCE"], settingsRows, mode);

  // CALL FOR HEAT SHEET
  const heatRows = heat.map(h => [CONFIG.ZONE_ID, CONFIG.ZONE_NAME, h.from, h.to, h.value, mode]);
  saveToSheet(ss, "Call For Heat", ["ZONE ID", "ZONE NAME", "FROM", "TO", "DEMAND", "SOURCE"], heatRows, mode);

  // WEATHER SHEET
  const weatherRows = weather.map(w => {
    const wMs = toMs(w.from);
    const sMatch = solar.reduce((prev, curr) => Math.abs(toMs(curr.timestamp)-wMs) < Math.abs(toMs(prev.timestamp)-wMs) ? curr : prev, solar[0]);
    return [dateStr, w.from, w.to, w.value.state, w.value.temperature.celsius, sMatch ? sMatch.value.percentage + "%" : "0%", mode];
  });
  saveToSheet(ss, "Weather", ["DATE", "FROM", "TO", "STATE", "OUTSIDE TEMP", "SOLAR %", "SOURCE"], weatherRows, mode);
}

/** --- UTILS --- **/

function saveToSheet(ss, name, headers, rows, mode) {
  if (rows.length === 0) return;
  let sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  if (mode === "TOP") {
    sheet.insertRowsAfter(1, rows.length);
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
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
