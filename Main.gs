/** * TADO DATA SYNC - MULTI-SHEET VERSION **/
const CONFIG = {
  HOME_ID: 1111111, // PUT YOUR OWN ID FROM Auth.gs
  ZONE_ID: 1, // ONLY 1 ZONE FOR THE TIME BEING
  ZONE_NAME: "Salón", // FILL WITH YOUR ZONE NAME
  CLIENT_ID: "1bb50063-6b0c-4d11-bd99-387f4a91cc46",
  INITIAL_REFRESH_TOKEN: "FILL WITH YOUR REFRESH TOKEN FROM Auth.gs",
  
  HISTORY_LIMIT_DATE: "2024-01-28",
  DAYS_PER_HISTORY_BATCH: 15, // RECOMMENDED BETWEEN 7 - 20 
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
  
  // 1. Process Main Measured Data (Temperature/Humidity)
  saveIntervalData(ss, "Measured Data", ["ZONE ID", "ZONE NAME", "DATE", "TIME", "TEMP (C)", "HUM %", "SOURCE"], 
    extractMeasuredRows(data, dateStr, mode), mode);

  // 2. Process Settings (Setpoints)
  saveIntervalData(ss, "Settings", ["ZONE ID", "ZONE NAME", "FROM", "TO", "TYPE", "SETPOINT", "SOURCE"], 
    extractIntervalRows(data.settings?.dataIntervals, dateStr, mode, "settings"), mode);

  // 3. Process Call for Heat (Boiler Demand)
  saveIntervalData(ss, "Call For Heat", ["ZONE ID", "ZONE NAME", "FROM", "TO", "DEMAND", "SOURCE"], 
    extractIntervalRows(data.callForHeat?.dataIntervals, dateStr, mode, "heat"), mode);

  // 4. Process Weather
  saveIntervalData(ss, "Weather", ["DATE", "FROM", "TO", "STATE", "OUTSIDE TEMP", "SOLAR %", "SOURCE"], 
    extractWeatherRows(data, dateStr, mode), mode);
}

/** --- EXTRACTION HELPERS --- **/

function extractMeasuredRows(data, dateStr, mode) {
  const temps = data.measuredData?.insideTemperature?.dataPoints || [];
  const hums = data.measuredData?.humidity?.dataPoints || [];
  const toMs = (ts) => new Date(ts).getTime();

  return temps.map(p => {
    const pMs = toMs(p.timestamp);
    const hMatch = hums.reduce((prev, curr) => Math.abs(toMs(curr.timestamp)-pMs) < Math.abs(toMs(prev.timestamp)-pMs) ? curr : prev, hums[0]);
    return [
      CONFIG.ZONE_ID, CONFIG.ZONE_NAME, dateStr, 
      Utilities.formatDate(new Date(pMs), CONFIG.TIMEZONE, CONFIG.TIME_FORMAT),
      p.value.celsius, hMatch ? (hMatch.value * 100).toFixed(1) : "N/A", mode
    ];
  });
}

function extractIntervalRows(intervals, dateStr, mode, type) {
  if (!intervals) return [];
  return intervals.map(item => {
    let base = [CONFIG.ZONE_ID, CONFIG.ZONE_NAME, item.from, item.to];
    if (type === "settings") {
      base.push(item.value.type, item.value.temperature?.celsius || "OFF");
    } else {
      base.push(item.value);
    }
    base.push(mode);
    return base;
  });
}

function extractWeatherRows(data, dateStr, mode) {
  const weather = data.weather?.condition?.dataIntervals || [];
  const solar = data.weather?.solarIntensity?.dataPoints || [];
  const toMs = (ts) => new Date(ts).getTime();

  return weather.map(w => {
    const wMs = toMs(w.from);
    const sMatch = solar.reduce((prev, curr) => Math.abs(toMs(curr.timestamp)-wMs) < Math.abs(toMs(prev.timestamp)-wMs) ? curr : prev, solar[0]);
    return [
      dateStr, w.from, w.to, w.value.state, w.value.temperature.celsius,
      sMatch ? sMatch.value.percentage + "%" : "0%", mode
    ];
  });
}

/** --- SHEET MANAGEMENT --- **/

function saveIntervalData(ss, sheetName, headers, rows, mode) {
  if (rows.length === 0) return;
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  
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

/**
 * SECURITY & AUTHENTICATION (TOKEN MANAGEMENT)
 * This function retrieves a valid access_token using the refresh_token.
 * It also automatically updates the refresh_token in Script Properties.
 */
function getAccessToken() {
  const props = PropertiesService.getScriptProperties();
  // It checks Script Properties first, then falls back to the INITIAL_REFRESH_TOKEN in CONFIG
  let refreshToken = props.getProperty('REFRESH_TOKEN') || CONFIG.INITIAL_REFRESH_TOKEN;
  
  if (!refreshToken || refreshToken === "YOUR_REFRESH_TOKEN_HERE") {
    throw new Error("No Refresh Token found. Please run the Handshake (Auth.gs) first.");
  }
  
  const payload = {
    "client_id": CONFIG.CLIENT_ID,
    "grant_type": "refresh_token",
    "refresh_token": refreshToken
  };
  
  const options = {
    "method": "post",
    "payload": payload,
    "muteHttpExceptions": true
  };
  
  const response = UrlFetchApp.fetch("https://login.tado.com/oauth2/token", options);
  const data = JSON.parse(response.getContentText());
  
  if (data.access_token) {
    // If the API provided a new refresh_token, we save it for next time
    if (data.refresh_token) {
      props.setProperty('REFRESH_TOKEN', data.refresh_token);
    }
    return data.access_token;
  } else {
    console.error("Auth Response: " + response.getContentText());
    throw new Error("Critical Auth Failure: Could not refresh access token. Check your credentials.");
  }
}
