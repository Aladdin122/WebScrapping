const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises; // For asynchronous file operations
const path = require('path'); // For handling file paths
const cron = require('node-cron'); // For scheduling tasks

// 🔧 Email and password for login
const email = 'Email'; 
const password = 'Password'; 

// 🔗 Webhook URL
const webhookUrl = 'https://services.leadconnectorhq.com/hooks/V80aofkSRvoJmhFV6p7v/webhook-trigger/36ef9b5e-2dc9-47de-9ea4-225c417ff0e2';

// 🔗 Onboarding URL
const onboardingUrl = 'https://signin.mindbodyonline.com/StaffOnboarding?code=Q2ZESjhLM21EL2UrT1hwS3ZXbFVvZk94ZEVoODFTTjc4eGUyUlAxejk1aDEzSE5OTHZCbTNJNHhXeFpjWENhaThvZ0VSRi9ZMUdrNUdPcHdLVnBsSTZuOTRzK3VCRjFQNVN0OGwvVzkxY2VWSHV4b2drQVRTN092YjZramloaDRoRXBaZnJsWUJvQkZKZlBqczZMY2FhODQxRFFVYU14VTBSWVBDeG1Jb09DUXRPUThzTDFES1pWR3BlOFNKcjVLWndkajY1VVVzUzhUMjBuTWV5aWxBaVVZWWx2U2xzM2hiSlZTUG5Vc25jWVlVcW5m&userId=6862b7736908d7ff2024dd77&subscriberId=5723165&customerAccountName=Chin+Up!+Aesthetics';

// 🔁 API URLs for the five specified days in the required order
const appointmentUrls = [
    'https://clients.mindbodyonline.com/DailyStaffSchedule/DailyStaffSchedules?studioID=5723165&isLibAsync=true&isJson=true&StartDate=1753056000&EndDate=1753056000&View=day&TabID=9&StaffIDs%5B%5D=0&programID=0&includeRequests=false', // 1st day
    'https://clients.mindbodyonline.com/DailyStaffSchedule/DailyStaffSchedules?studioID=5723165&isLibAsync=true&isJson=true&StartDate=1753142400&EndDate=1753142400&View=day&TabID=9&StaffIDs%5B%5D=0&programID=0&includeRequests=false', // 2nd day
    'https://clients.mindbodyonline.com/DailyStaffSchedule/DailyStaffSchedules?studioID=5723165&isLibAsync=true&isJson=true&StartDate=1753228800&EndDate=1753228800&View=day&TabID=9&StaffIDs%5B%5D=0&programID=0&includeRequests=false', // 3rd day
    'https://clients.mindbodyonline.com/DailyStaffSchedule/DailyStaffSchedules?studioID=5723165&isLibAsync=true&isJson=true&StartDate=1753315200&EndDate=1753315200&View=day&TabID=9&StaffIDs%5B%5D=0&programID=0&includeRequests=false', // 4th day
    'https://clients.mindbodyonline.com/DailyStaffSchedule/DailyStaffSchedules?studioID=5723165&isLibAsync=true&isJson=true&StartDate=1753401600&EndDate=1753401600&View=day&TabID=9&StaffIDs%5B%5D=0&programID=0&includeRequests=false', // 5th day
];

// 📁 Path to the file storing previous appointments
const PREVIOUS_APPOINTMENTS_FILE = path.join(__dirname, 'previous_appointments.json');

// 🌐 Global variables for browser, page, and login status
let browserInstance = null;
let pageInstance = null;
let isLoggedIn = false;

// Constant email address for GHL webhook
const GHL_CONTACT_EMAIL = 'updates.checker@gmail.com'; // Changed email address

/**
 * 💾 Loads previously stored appointments from a JSON file.
 * @returns {Promise<Array>} Array of stored appointments.
 */
async function loadPreviousAppointments() {
    try {
        const data = await fs.readFile(PREVIOUS_APPOINTMENTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('ℹ️ Previous appointments file not found. Starting fresh.');
            return []; // If file doesn't exist, start with an empty array
        }
        console.error('❌ Error loading previous appointments:', error.message);
        return [];
    }
}

/**
 * 📝 Saves current appointments to a JSON file.
 * @param {Array} appointments - Array of appointments to save.
 */
async function saveCurrentAppointments(appointments) {
    try {
        await fs.writeFile(PREVIOUS_APPOINTMENTS_FILE, JSON.stringify(appointments, null, 2), 'utf8');
        console.log('✅ Current appointments saved successfully.');
    } catch (error) {
        console.error('❌ Error saving current appointments:', error.message);
    }
}

/**
 * 🧹 Cleans an appointment object by removing properties with null, 0, false, or 'none' values.
 * This function creates a new object and copies only valid properties.
 * @param {object} app - The appointment object to clean.
 * @returns {object} The cleaned appointment object.
 */
function cleanAppointmentObject(app) {
    const cleanedApp = {};
    for (const key in app) {
        if (Object.prototype.hasOwnProperty.call(app, key)) {
            const value = app[key];
            // Check for null, 0, false, 'none' (case-insensitive)
            if (value !== null && value !== 0 && value !== false && String(value).toLowerCase() !== 'none') {
                cleanedApp[key] = value;
            }
        }
    }
    return cleanedApp;
}

/**
 * 🔄 Compares old and new appointments to identify changes (added, cancelled, modified).
 * Assumes each appointment has a unique ID (e.g., AppointmentID) and client details.
 * @param {Array} oldAppointments - The previously fetched flat list of appointments.
 * @param {Array} newAppointments - The newly fetched flat list of appointments.
 * @returns {object} Object containing added, cancelled, and modified appointments.
 */
function compareAppointments(oldAppointments, newAppointments) {
    const added = [];
    const cancelled = [];
    const modified = [];

    // Create Maps for quick lookup by AppointmentID for initial comparison
    const oldAppointmentsMap = new Map();
    oldAppointments.forEach(app => {
        if (app.ID) {
            oldAppointmentsMap.set(app.ID, app);
        }
    });

    const newAppointmentsMap = new Map();
    newAppointments.forEach(app => {
        if (app.ID) {
            newAppointmentsMap.set(app.ID, app);
        }
    });

    // Step 1: Identify initial additions and potential modifications
    newAppointments.forEach(newApp => {
        if (newApp.ID) {
            const oldApp = oldAppointmentsMap.get(newApp.ID);
            if (!oldApp) {
                // It's a new appointment (ID not found in old list)
                added.push(newApp);
            } else {
                // Same ID, check for content change to identify as modified
                if (JSON.stringify(oldApp) !== JSON.stringify(newApp)) {
                    // This is an actual modification of an existing appointment
                    // We'll handle this by adding to 'modified' list
                    modified.push({ old: oldApp, new: newApp, type: 'content_modified' });
                }
            }
        }
    });

    // Step 2: Identify initial cancellations and refine modifications
    oldAppointments.forEach(oldApp => {
        if (oldApp.ID) {
            const newApp = newAppointmentsMap.get(oldApp.ID);
            if (!newApp) {
                // It's a cancelled appointment (ID not found in new list)
                cancelled.push(oldApp);
            }
        }
    });

    // Step 3: Refine 'cancelled' and 'added' to find 'moved/changed client' modifications
    // This handles the case where an appointment ID changes, but client details remain the same.
    // We'll iterate through the initially identified 'cancelled' appointments.
    const finalAdded = [];
    const finalCancelled = [];
    const finalModified = [...modified]; // Start with content modifications

    const processedNewAppIds = new Set(); // To avoid double-processing new appointments

    cancelled.forEach(oldCancelledApp => {
        // Create a unique identifier for the client based on name, phone, email
        const clientIdentifier = `${oldCancelledApp.ClientName || ''}_${oldCancelledApp.ClientMobilePhone || ''}_${oldCancelledApp.ClientEmail || ''}`;
        let foundAsModified = false;

        // Search in the 'added' list for an appointment with the same client details
        for (let i = 0; i < added.length; i++) {
            const newAddedApp = added[i];
            if (processedNewAppIds.has(newAddedApp.ID)) {
                continue; // Skip if this new app was already matched
            }

            const newClientIdentifier = `${newAddedApp.ClientName || ''}_${newAddedApp.ClientMobilePhone || ''}_${newAddedApp.ClientEmail || ''}`;

            if (clientIdentifier === newClientIdentifier) {
                // Found a match: this is a modification (moved/changed time for same client)
                finalModified.push({ old: oldCancelledApp, new: newAddedApp, type: 'client_details_match' });
                processedNewAppIds.add(newAddedApp.ID); // Mark this new app as processed
                foundAsModified = true;
                break; // Move to the next cancelled app
            }
        }

        if (!foundAsModified) {
            // If not found as a modification, it's a true cancellation
            finalCancelled.push(oldCancelledApp);
        }
    });

    // Add any remaining truly new appointments
    added.forEach(newAddedApp => {
        if (!processedNewAppIds.has(newAddedApp.ID)) {
            finalAdded.push(newAddedApp);
        }
    });

    return { added: finalAdded, cancelled: finalCancelled, modified: finalModified };
}


/**
 * 🧑‍💻 Login function
 * Handles the login process.
 * @param {Page} page - Puppeteer page instance.
 * @returns {Promise<boolean>} True if login is successful, false otherwise.
 */
async function login(page) {
    console.log('Attempting login...');
    try {
        await page.goto(onboardingUrl, { waitUntil: 'networkidle2' });

        // Try to click "Continue to Sign In" if present
        try {
            await page.waitForSelector('a[href*="launch?studioid="]', { timeout: 15000 });
            await page.click('a[href*="launch?studioid="]');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            console.log('✅ Clicked "Continue to Sign In".');
        } catch (err) {
            console.log('❗️"Continue to Sign In" button not found. Skipping...');
        }

        // Login form interaction
        await page.waitForSelector('input#username', { timeout: 15000 });
        await page.type('input#username', email);
        await page.type('input[type="password"]', password);

        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);
        console.log(`✅ Logged in as ${email}`);

        // Location Step (if required)
        try {
            await page.waitForSelector('button[type="submit"]', { timeout: 5000 });
            await page.click('button[type="submit"]');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
            console.log('✅ Skipped location step');
        } catch (e) {
            console.log('ℹ️ No location selection required.');
        }

        // Navigate to the main appointments page after login
        await page.goto('https://clients.mindbodyonline.com/app/business/mainappointments/index', { waitUntil: 'networkidle2', timeout: 60000 }); // Added timeout here
        console.log('✅ Arrived at main appointments page (or attempted).');

        return true; // Login successful
    } catch (err) {
        console.error('❌ Failed during login process:', err.message);
        isLoggedIn = false; // Mark as not logged in
        return false; // Login failed
    }
}

/**
 * 🚀 Main function to scrape appointments and send updates.
 */
async function scrapeAndSendUpdates() {
    console.log(`\n--- Starting scrape and update process at ${new Date().toLocaleString()} ---`);

    let dataFetchError = false; // Flag to track if any API fetching error occurred

    try {
        // If browser instance does not exist or not logged in, launch and login
        if (!browserInstance || !isLoggedIn) {
            if (browserInstance) { // Close existing browser if not logged in
                await browserInstance.close();
                console.log('🧹 Closing previous browser instance due to logout/error.');
            }
            browserInstance = await puppeteer.launch({
                headless: false, // Run browser in visible mode for debugging
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
            pageInstance = await browserInstance.newPage();
            isLoggedIn = await login(pageInstance); // Attempt login
            if (!isLoggedIn) {
                console.error('❌ Could not establish a valid login session. Skipping this run.');
                return; // Stop current run if login failed
            }
        }

        let totalAppointmentsCount = 0; // To store the total number of appointments
        const dailyAppointmentCounts = {}; // To store appointment counts per day with clear labels
        let currentAllAppointmentsData = []; // To store all raw appointment objects fetched in the current run

        // 📅 Loop through all specified API URLs
        for (let i = 0; i < appointmentUrls.length; i++) {
            const apiUrl = appointmentUrls[i];
            let fetchedAppointmentsForDay = []; // To store raw appointments for this day

            try {
                // Use Promise.all to ensure the listener is ready before navigation
                const [response] = await Promise.all([
                    // Wait for the specific API response containing DailyStaffSchedules data
                    pageInstance.waitForResponse(res => res.url() === apiUrl && res.ok(), { timeout: 30000 }), // Ensure URL matches exactly
                    // Navigate directly to the API URL
                    pageInstance.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
                ]);

                const fullJson = await response.json(); // Parse the full JSON response

                // Access the 'json' array within the fullJson object
                if (fullJson && Array.isArray(fullJson.json)) {
                    // Collect all appointments from each day's 'json' array
                    fetchedAppointmentsForDay = fullJson.json.flatMap(dayData => dayData.Appointments || []);
                } else {
                    console.log('❌ Unexpected JSON response structure. "json" array not found or not an array.');
                    dataFetchError = true; // Set error flag if structure is unexpected
                }

                console.log(`✅ Found ${fetchedAppointmentsForDay.length} appointments for ${apiUrl}.`);
                // Store daily appointment count with clear label
                const dayLabel = `${i + 1}`;
                dailyAppointmentCounts[`Total appointments for day ${dayLabel} is:`] = fetchedAppointmentsForDay.length;
                totalAppointmentsCount += fetchedAppointmentsForDay.length; // Add to total appointment count
                currentAllAppointmentsData = currentAllAppointmentsData.concat(fetchedAppointmentsForDay); // Add raw appointments for this day to the total list

            } catch (err) {
                console.error(`❌ Failed to fetch or parse API response for ${apiUrl}:`, err.message);
                const dayLabel = `${i + 1}`;
                dailyAppointmentCounts[`Total appointments for day ${dayLabel} is:`] = 0; // Record 0 if fetch failed
                dataFetchError = true; // Set error flag if fetch failed
            }

            // 3-second pause between API calls to prevent overloading
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        console.log(`✅ Total appointments found across all APIs: ${totalAppointmentsCount}.`);

        // 💾 Load previous appointments for comparison
        const previousAllAppointmentsData = await loadPreviousAppointments();

        // 🔄 Compare data to identify additions, cancellations, and modifications
        const { added, cancelled, modified } = compareAppointments(previousAllAppointmentsData, currentAllAppointmentsData);

        // 📤 Send data to Webhook
        const TestGHLMail = GHL_CONTACT_EMAIL; // Using the constant email
        console.log(`🧪 GHL Contact Email: ${TestGHLMail}`);

        let messageText = ''; // Initialize messageText as empty string
        const hasChanges = added.length > 0 || cancelled.length > 0 || modified.length > 0;

        // Declare cleaned arrays outside the if block
        const cleanedAdded = added.map(cleanAppointmentObject);
        const cleanedCancelled = cancelled.map(cleanAppointmentObject);
        const cleanedModified = modified.map(m => ({
            old: cleanAppointmentObject(m.old),
            new: cleanAppointmentObject(m.new),
            type: m.type
        }));

        if (dataFetchError) {
            messageText = '❌ Could not find appointments data due to network or data parsing error.';
        } else if (hasChanges) {
            messageText = `✅ Updates found: ${added.length} added, ${cancelled.length} cancelled, ${modified.length} modified.`;

            // Append details for Added Appointments
            if (cleanedAdded.length > 0) {
                messageText += '\n--- Added Appointments ---';
                cleanedAdded.forEach(app => {
                    messageText += `\nClient ID: ${app.ClientID || app.ID || 'N/A'}, Session Type ID: ${app.SessionTypeID || 'N/A'}, Location ID: ${app.LocationID || 'N/A'}`;
                });
            }

            // Append details for Cancelled Appointments
            if (cleanedCancelled.length > 0) {
                messageText += '\n--- Cancelled Appointments ---';
                cleanedCancelled.forEach(app => {
                    messageText += `\nClient ID: ${app.ClientID || app.ID || 'N/A'}, Session Type ID: ${app.SessionTypeID || 'N/A'}, Location ID: ${app.LocationID || 'N/A'}`;
                });
            }

            // Append details for Modified Appointments
            if (cleanedModified.length > 0) {
                messageText += '\n--- Modified Appointments ---';
                cleanedModified.forEach(m => {
                    const oldDate = m.old.StartDateTime ? new Date(m.old.StartDateTime * 1000).toLocaleString() : 'N/A';
                    const newDate = m.new.StartDateTime ? new Date(m.new.StartDateTime * 1000).toLocaleString() : 'N/A';
                    messageText += `\nClient ID: ${m.new.ClientID || m.new.ID || 'N/A'}, Session Type ID: ${m.new.SessionTypeID || 'N/A'}, Location ID: ${m.new.LocationID || 'N/A'}, Old Date: ${oldDate}, New Date: ${newDate}`;
                });
            }

        } else {
            messageText = 'ℹ️ No new updates in this 5 working days.';
        }

        const payload = {
            eventType: 'AppointmentsUpdateScanResult', // Event type reflecting scan and update results
            timestamp: new Date().toISOString(),
            contactEmail: TestGHLMail,
            message: messageText // Message indicating updates or no updates
        };

        // Add daily and total counts back to the payload
        Object.assign(payload, dailyAppointmentCounts);
        payload['Total appointments in this 5 working days is:'] = totalAppointmentsCount;

        // Add update arrays after cleaning, only if they are not empty
        if (cleanedAdded.length > 0) {
            payload.addedAppointments = cleanedAdded;
        }
        if (cleanedCancelled.length > 0) {
            payload.cancelledAppointments = cleanedCancelled;
        }
        if (cleanedModified.length > 0) {
            payload.modifiedAppointments = cleanedModified;
        }
        
        try {
            const res = await axios.post(webhookUrl, payload);
            console.log(`📬 Webhook sent. Status: ${res.status}`);
        } catch (err) {
            console.error('❌ Failed to send webhook:', err.message);
        }

        // 📝 Save current appointments as previous data for the next run
        // Only save if there was no data fetch error, to prevent overwriting valid data with empty/partial data
        if (!dataFetchError) {
            await saveCurrentAppointments(currentAllAppointmentsData);
        } else {
            console.log('⚠️ Not saving current appointments due to data fetch error. Retaining previous state.');
        }

    } catch (error) {
        console.error('❌ An unexpected error occurred during the script execution:', error.message);
        // If a general error occurs, the session might be invalid, so reset isLoggedIn
        isLoggedIn = false;
    } finally {
        // Do not close the browser here; keep it open for scheduled tasks
        // It will be closed when the script is fully stopped
    }
}

// ⏰ Schedule the script to run every 10 minutes (can be adjusted if not needed currently)
cron.schedule('*/10 * * * *', () => {
    console.log('--- Running scheduled task: Fetching and updating appointments ---');
    scrapeAndSendUpdates();
}, {
    scheduled: true,
    timezone: "Africa/Cairo" // Set timezone to Cairo
});

// 🏁 Initial startup function
(async () => {
    console.log('🚀 Initializing Puppeteer and performing first login...');
    // Launch browser and perform initial login
    browserInstance = await puppeteer.launch({
        headless: false, // Run browser in visible mode
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    pageInstance = await browserInstance.newPage();
    isLoggedIn = await login(pageInstance);

    if (isLoggedIn) {
        console.log('✅ Initial login successful. Starting first data scrape.');
        await scrapeAndSendUpdates(); // Execute first scrape after successful login
    } else {
        console.error('❌ Initial login failed. Script will not proceed with scraping until next scheduled attempt or manual restart.');
        if (browserInstance) {
            await browserInstance.close(); // Close browser if initial login failed
            browserInstance = null;
            pageInstance = null;
        }
    }

    // Add process exit handlers to ensure proper browser closure
    process.on('SIGINT', async () => {
        console.log('Received SIGINT. Closing browser...');
        if (browserInstance) {
            await browserInstance.close();
        }
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        console.log('Received SIGTERM. Closing browser...');
        if (browserInstance) {
            await browserInstance.close();
        }
        process.exit(0);
    });

})();
