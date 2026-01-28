/** * TADO AUTHENTICATION HELPER (OAUTH2 DEVICE FLOW)
 * * This script allows you to link your Google Sheets to Tado securely.
 */

const AUTH_CONFIG = {
  CLIENT_ID: "1bb50063-6b0c-4d11-bd99-387f4a91cc46", 
  SCOPE: "home.user offline_access",
  // PASTE THE CODE FROM STEP 1 HERE:
  DEVICE_CODE: "dI7EsnUB4MswNJMT9ymGR65ySzlARvKl2PjWPpjIXxM" 
};

/**
 * STEP 1: Request Authorization
 * Run this function and check the "Execution Log".
 */
function requestAuthorization() {
  const url = "https://login.tado.com/oauth2/device_authorize";
  const payload = {
    "client_id": AUTH_CONFIG.CLIENT_ID,
    "scope": AUTH_CONFIG.SCOPE
  };
  
  const response = UrlFetchApp.fetch(url, {
    "method": "post",
    "payload": payload
  });
  
  const data = JSON.parse(response.getContentText());
  
  console.log("--- TADO AUTHENTICATION STEPS ---");
  console.log("1. OPEN THIS LINK: " + data.verification_uri_complete);
  console.log("2. LOG IN TO TADO AND CONFIRM ACCESS.");
  console.log("3. ONCE AUTHORIZED, COPY THIS DEVICE CODE: " + data.device_code);
  console.log("4. PASTE IT IN 'AUTH_CONFIG.DEVICE_CODE' ABOVE AND RUN 'finalizeTokenRequest'.");
}

/**
 * STEP 2: Finalize Token Request
 * Uses the DEVICE_CODE defined in AUTH_CONFIG.
 */
function finalizeTokenRequest() {
  if (!AUTH_CONFIG.DEVICE_CODE || AUTH_CONFIG.DEVICE_CODE === "PASTE_YOUR_DEVICE_CODE_HERE") {
    console.error("❌ ERROR: You must paste the Device Code into AUTH_CONFIG.DEVICE_CODE first.");
    return;
  }
  
  const url = "https://login.tado.com/oauth2/token";
  const payload = {
    "client_id": AUTH_CONFIG.CLIENT_ID,
    "device_code": AUTH_CONFIG.DEVICE_CODE,
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
  };
  
  const response = UrlFetchApp.fetch(url, {
    "method": "post",
    "payload": payload,
    "muteHttpExceptions": true
  });
  
  const result = JSON.parse(response.getContentText());
  
  if (result.refresh_token) {
    const separator = "****************************************************************";
    console.log("\n" + separator);
    console.log("✅ AUTHENTICATION SUCCESSFUL!");
    console.log(separator);
    console.log("COPY THE REFRESH TOKEN BELOW:");
    console.log("\n" + result.refresh_token + "\n");
    console.log(separator);
    console.log("-> Paste this token into your Main.gs CONFIG file.");
    console.log(separator + "\n");
    
    // Save it to Script Properties so the main script can use it immediately
    PropertiesService.getScriptProperties().setProperty('REFRESH_TOKEN', result.refresh_token);
  } else {
    console.warn("❌ ERROR: Could not retrieve token.");
    console.log("Response: " + response.getContentText());
    console.log("Tip: Ensure you approved the link in your browser before running this.");
  }
}

/**
 * HOME DISCOVERY UTILITY
 * Use this to verify your HOME_ID after obtaining the token.
 */
function discoverHomeId() {
  const token = getAccessToken(); // Ensure this exists in Main.gs or current file
  const url = "https://my.tado.com/api/v2/me";
  
  const response = UrlFetchApp.fetch(url, {
    "headers": {"Authorization": "Bearer " + token}
  });
  
  const data = JSON.parse(response.getContentText());
  console.log("--- YOUR TADO HOMES ---");
  data.homes.forEach(home => {
    console.log("🏡 Home: " + home.name + " | ID: " + home.id);
  });
}
