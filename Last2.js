const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs').promises; // لاستخدام وظائف الملفات غير المتزامنة
const path = require('path'); // للتعامل مع مسارات الملفات
const cron = require('node-cron'); // لاستخدام الجدولة

// 🔧 الإيميل والباسورد لتسجيل الدخول
const email = 'alaataha275@gmail.com';
const password = 'Lay03639008';

// 🔗 رابط Webhook
const webhookUrl = 'https://services.leadconnectorhq.com/hooks/V80aofkSRvoJmhFV6p7v/webhook-trigger/36ef9b5e-2dc9-47de-9ea4-225c417ff0e2';

// 🔗 رابط الـ Onboarding
const onboardingUrl = 'https://signin.mindbodyonline.com/StaffOnboarding?code=Q2ZESjhLM21EL2UrT1hwS3ZXbFVvZk94ZEVoODFTTjc4eGUyUlAxejk1aDEzSE5OTHZCbTNJNHhXeFpjWENhaThvZ0VSRi9ZMUdrNUdPcHdLVnBsSTZuOTRzK3VCRjFQNVN0OGwvVzkxY2VWSHV4b2drQVRTN092YjZramloaDRoRXBaZnJsWUJvQkZKZlBqczZMY2FhODQxRFFVYU14VTBSWVBDeG1Jb09DUXRPUThzTDFES1pWR3BlOFNKcjVLWndkajY1VVVzUzhUMjBuTWV5aWxBaVVZWWx2U2xzM2hiSlZTUG5Vc25jWVlVcW5m&userId=6862b7736908d7ff2024dd77&subscriberId=5723165&customerAccountName=Chin+Up!+Aesthetics';

// 🔁 روابط API للأيام الخمسة المحددة بالترتيب المطلوب
const appointmentUrls = [
    'https://clients.mindbodyonline.com/DailyStaffSchedule/DailyStaffSchedules?studioID=5723165&isLibAsync=true&isJson=true&StartDate=1753056000&EndDate=1753056000&View=day&TabID=9&StaffIDs%5B%5D=0&programID=0&includeRequests=false', // 1st day
    'https://clients.mindbodyonline.com/DailyStaffSchedule/DailyStaffSchedules?studioID=5723165&isLibAsync=true&isJson=true&StartDate=1752796800&EndDate=1752796800&View=day&TabID=9&StaffIDs%5B%5D=0&programID=0&includeRequests=false', // 2nd day
    'https://clients.mindbodyonline.com/DailyStaffSchedule/DailyStaffSchedules?studioID=5723165&isLibAsync=true&isJson=true&StartDate=1752883200&EndDate=1752883200&View=day&TabID=9&StaffIDs%5B%5D=0&programID=0&includeRequests=false', // 3rd day
    'https://clients.mindbodyonline.com/DailyStaffSchedule/DailyStaffSchedules?studioID=5723165&isLibAsync=true&isJson=true&StartDate=1753228800&EndDate=1753228800&View=day&TabID=9&StaffIDs%5B%5D=0&programID=0&includeRequests=false', // 4th day
    'https://clients.mindbodyonline.com/DailyStaffSchedule/DailyStaffSchedules?studioID=5723165&isLibAsync=true&isJson=true&StartDate=1753142400&EndDate=1753142400&View=day&TabID=9&StaffIDs%5B%5D=0&programID=0&includeRequests=false', // 5th day
];

// 📁 مسار ملف تخزين المواعيد السابقة
const PREVIOUS_APPOINTMENTS_FILE = path.join(__dirname, 'previous_appointments.json');

// 🌐 متغيرات عامة للمتصفح والصفحة وحالة تسجيل الدخول
let browserInstance = null;
let pageInstance = null;
let isLoggedIn = false;

/**
 * ✅ توليد إيميل عشوائي للاستخدام في GHL
 * Generates a random email address for GHL.
 */
function generateRandomEmail() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const name = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${name}@gmail.com`;
}

/**
 * 💾 تحميل المواعيد المخزنة سابقًا من ملف JSON.
 * Loads previously stored appointments from a JSON file.
 * @returns {Promise<Array>} Array of stored appointments.
 */
async function loadPreviousAppointments() {
    try {
        const data = await fs.readFile(PREVIOUS_APPOINTMENTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('ℹ️ Previous appointments file not found. Starting fresh.');
            return []; // إذا لم يكن الملف موجودًا، ابدأ بمصفوفة فارغة
        }
        console.error('❌ Error loading previous appointments:', error.message);
        return [];
    }
}

/**
 * 📝 حفظ المواعيد الحالية في ملف JSON.
 * Saves current appointments to a JSON file.
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
 * 🔄 مقارنة المواعيد القديمة بالجديدة لتحديد التغييرات (إضافة، إلغاء، تعديل).
 * Compare old and new appointments to identify changes (added, cancelled, modified).
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
 * 🧑‍💻 وظيفة تسجيل الدخول
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
        // Removed specific selector wait as it was causing issues and not strictly needed for API calls.
        await page.goto('https://clients.mindbodyonline.com/app/business/mainappointments/index', { waitUntil: 'networkidle2' });
        console.log('✅ Arrived at main appointments page (or attempted).');

        return true; // Login successful
    } catch (err) {
        console.error('❌ Failed during login process:', err.message);
        isLoggedIn = false; // Mark as not logged in
        return false; // Login failed
    }
}

/**
 * 🚀 الوظيفة الرئيسية لجلب المواعيد وإرسال التحديثات.
 * Main function to scrape appointments and send updates.
 */
async function scrapeAndSendUpdates() {
    console.log(`\n--- Starting scrape and update process at ${new Date().toLocaleString()} ---`);

    try {
        // إذا لم يكن المتصفح موجودًا أو لم نكن مسجلين دخول، نقوم بتشغيله وتسجيل الدخول
        if (!browserInstance || !isLoggedIn) {
            if (browserInstance) { // Close existing browser if not logged in
                await browserInstance.close();
                console.log('🧹 Closing previous browser instance due to logout/error.');
            }
            browserInstance = await puppeteer.launch({
                headless: false, // تشغيل المتصفح مرئيًا لرؤية المشاكل
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            });
            pageInstance = await browserInstance.newPage();
            isLoggedIn = await login(pageInstance); // محاولة تسجيل الدخول
            if (!isLoggedIn) {
                console.error('❌ Could not establish a valid login session. Skipping this run.');
                return; // إيقاف التشغيل الحالي إذا فشل تسجيل الدخول
            }
        }

        let totalAppointmentsCount = 0; // لتخزين العدد الكلي للمواعيد
        const dailyAppointmentCounts = {}; // لتخزين عدد المواعيد لكل يوم بتسمية واضحة
        let currentAllAppointmentsData = []; // لتخزين جميع كائنات المواعيد المجمعة من كل الـ APIs في التشغيل الحالي

        // 📅 Loop through all specified API URLs
        for (let i = 0; i < appointmentUrls.length; i++) {
            const apiUrl = appointmentUrls[i];
            let fetchedAppointmentsForDay = []; // لتخزين المواعيد الخام لهذا اليوم

            try {
                // استخدم Promise.all لضمان أن المستمع جاهز قبل التنقل
                const [response] = await Promise.all([
                    // انتظر استجابة API المحددة التي تحتوي على بيانات DailyStaffSchedules
                    pageInstance.waitForResponse(res => res.url() === apiUrl && res.ok(), { timeout: 30000 }), // تأكد من مطابقة الـ URL بالضبط
                    // انتقل إلى URL الـ API مباشرة
                    pageInstance.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
                ]);

                const fullJson = await response.json(); // تحليل استجابة JSON الكاملة

                // الوصول إلى مصفوفة 'json' داخل كائن fullJson
                if (fullJson && Array.isArray(fullJson.json)) {
                    // نجمع كل المواعيد من كل الأيام في مصفوفة 'json'
                    fetchedAppointmentsForDay = fullJson.json.flatMap(dayData => dayData.Appointments || []);
                } else {
                    console.log('❌ Unexpected JSON response structure. "json" array not found or not an array.');
                }

                console.log(`✅ Found ${fetchedAppointmentsForDay.length} appointments for ${apiUrl}.`);
                // حفظ عدد المواعيد لهذا اليوم بتسمية واضحة
                const dayLabel = `${i + 1}`;
                dailyAppointmentCounts[`Total appointments for day ${dayLabel} is:`] = fetchedAppointmentsForDay.length;
                totalAppointmentsCount += fetchedAppointmentsForDay.length; // إضافة لعدد المواعيد الكلي
                currentAllAppointmentsData = currentAllAppointmentsData.concat(fetchedAppointmentsForDay); // إضافة المواعيد الخام لهذا اليوم إلى القائمة الكلية

            } catch (err) {
                console.error(`❌ Failed to fetch or parse API response for ${apiUrl}:`, err.message);
                const dayLabel = `${i + 1}`;
                dailyAppointmentCounts[`Total appointments for day ${dayLabel} is:`] = 0; // تسجيل 0 إذا فشل الجلب
            }

            // فترة راحة 3 ثواني بين استدعاءات الـ API لتجنب التحميل الزائد
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        console.log(`✅ Total appointments found across all APIs: ${totalAppointmentsCount}.`);

        // 💾 تحميل المواعيد السابقة للمقارنة
        const previousAllAppointmentsData = await loadPreviousAppointments();

        // 🔄 مقارنة البيانات لتحديد الإضافات والإلغاءات والتعديلات
        const { added, cancelled, modified } = compareAppointments(previousAllAppointmentsData, currentAllAppointmentsData);

        // 📤 إرسال البيانات إلى Webhook
        const TestGHLMail = generateRandomEmail();
        console.log(`🧪 TestGHLMail generated: ${TestGHLMail}`);

        let messageText;
        if (added.length > 0 || cancelled.length > 0 || modified.length > 0) {
            messageText = `✅ Updates found: ${added.length} added, ${cancelled.length} cancelled, ${modified.length} modified.`;
        } else {
            messageText = 'ℹ️ No new updates in this 5 working days.';
        }

        const payload = {
            eventType: 'AppointmentsUpdateScanResult', // نوع حدث يعكس نتيجة الفحص والتحديثات
            timestamp: new Date().toISOString(),
            ...dailyAppointmentCounts, // عدد المواعيد لكل يوم
            'Total appointments in this 5 working days is:': totalAppointmentsCount, // العدد الكلي للمواعيد
            addedAppointments: added, // المواعيد الجديدة
            cancelledAppointments: cancelled, // المواعيد الملغاة
            modifiedAppointments: modified, // المواعيد المعدلة
            // allAppointmentsData: allAppointmentsData, // تم إزالة هذا السطر بناءً على طلبك
            contactEmail: TestGHLMail,
            message: messageText // الرسالة التي توضح وجود تحديثات أو عدمه
        };

        try {
            const res = await axios.post(webhookUrl, payload);
            console.log(`📬 Webhook sent. Status: ${res.status}`);
        } catch (err) {
            console.error('❌ Failed to send webhook:', err.message);
        }

        // 📝 حفظ المواعيد الحالية كبيانات سابقة للمقارنة التالية
        await saveCurrentAppointments(currentAllAppointmentsData);

    } catch (error) {
        console.error('❌ An unexpected error occurred during the script execution:', error.message);
        // إذا حدث خطأ عام، قد تكون الجلسة غير صالحة، لذا نعيد تعيين isLoggedIn
        isLoggedIn = false;
    } finally {
        // لا نغلق المتصفح هنا، بل نتركه مفتوحًا لإعادة الاستخدام في المهام المجدولة
        // سيتم إغلاقه عند إيقاف السكريبت بالكامل
    }
}

// ⏰ جدولة السكريبت للتشغيل كل 10 دقائق (يمكنك تعديل هذا إذا كنت لا تريد جدولة حاليًا)
// Schedule the script to run every 10 minutes
cron.schedule('*/10 * * * *', () => {
    console.log('--- Running scheduled task: Fetching and updating appointments ---');
    scrapeAndSendUpdates();
}, {
    scheduled: true,
    timezone: "Africa/Cairo" // Set timezone to Cairo
});

// 🏁 وظيفة بدء التشغيل الأولية
// Initial startup function
(async () => {
    console.log('🚀 Initializing Puppeteer and performing first login...');
    // تشغيل المتصفح وتسجيل الدخول لأول مرة
    browserInstance = await puppeteer.launch({
        headless: false, // تشغيل المتصفح مرئيًا
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    pageInstance = await browserInstance.newPage();
    isLoggedIn = await login(pageInstance);

    if (isLoggedIn) {
        console.log('✅ Initial login successful. Starting first data scrape.');
        await scrapeAndSendUpdates(); // تنفيذ أول عملية جلب بعد تسجيل الدخول بنجاح
    } else {
        console.error('❌ Initial login failed. Script will not proceed with scraping until next scheduled attempt or manual restart.');
        if (browserInstance) {
            await browserInstance.close(); // إغلاق المتصفح إذا فشل تسجيل الدخول الأولي
            browserInstance = null;
            pageInstance = null;
        }
    }

    // إضافة معالج لحدث إغلاق العملية لضمان إغلاق المتصفح بشكل صحيح
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
