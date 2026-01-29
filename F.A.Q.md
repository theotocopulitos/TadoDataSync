## ❓ Frequently Asked Questions (FAQ)

### 🔑 Setup & Access

**How do I find my Zone ID and Home ID?**
When you run the `requestAuthorization` function and complete the linking process, the script will attempt to display your data in the execution log. If it doesn't, you can check the logs of the first synchronization. Usually, the main heating zone is ID `1`.

**Is it safe to not use a password in the script?**
Yes, it is **much safer**. By using the *OAuth2 Device Flow* standard, the script never knows or stores your password. It only saves an encrypted "Refresh Token" in Google’s script properties. If you ever want to revoke access, you can do so directly from your Tado account dashboard.

---

### 📈 Data & Limitations

**Why do I only see data for the last 13 months?**
This is a limitation of Tado's servers. Even if you are a long-time user, Tado typically purges detailed API history after approximately 400 days. The script will automatically retrieve the maximum history that Tado is able to provide.

**Can I sync multiple zones or Hot Water (DHW)?**
This script is specifically designed and optimized for a **single heating zone**. If you have multiple zones, the script will only fetch data for the ID configured in `CONFIG.ZONE_ID`. Support for Hot Water or multi-zone setups would require additional mapping logic that is currently not implemented.

**What does "Call for Heat" mean in the data?**
It represents the percentage of demand the zone is requesting from the boiler (from 0% to 100%). It is the most accurate indicator for estimating actual energy consumption, as it shows how long and at what intensity the boiler has been working.

---

### 🛠️ Troubleshooting

**The script takes too long or gives a "Timeout" error**
Google limits scripts to a maximum of 6 minutes of continuous execution. If you are retrieving many months of history at once, the script may stop.
- Reduce the `DAYS_PER_HISTORY_BATCH` value to 5 or 10 days.
- Run the "Effective Cleanup" from the menu only after the total data download is complete.

**I see "Rate Limit" or "429" errors**
Tado limits the number of requests per minute to protect its servers. The script includes pauses (`Utilities.sleep`) to avoid this, but if you run many tests in a row, you might be temporarily blocked by Tado (the block usually lasts one hour).

**Why doesn't the time in the sheet match my local clock?**
Check the `TIMEZONE` constant in the `CONFIG` block of `Main.gs`. It must match your region (e.g., `"GMT+1"` or `"Europe/Madrid"`). Also, ensure that the spreadsheet's own settings (**File > Settings > Time zone**) match the script's configuration.
