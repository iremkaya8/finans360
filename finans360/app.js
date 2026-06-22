/**
 * Finans360 - Bütçe ve Borç Yönetim Sistemi
 * Uygulama Mantığı ve Grafik Entegrasyonları
 */

// ==========================================================================
// 1. UYGULAMA DURUMU (STATE) VE LOCALSTORAGE ENTEGRASYONU
// ==========================================================================

const STATE = {
    budget: {
        income: 0,
        rent: 0,
        groceries: 0,
        transport: 0,
        bills: 0,
        education: 0,
        health: 0,
        social: 0,
        others: 0
    },
    debts: [],
    editingDebtId: null,
    extraMonthlyPayment: 0,
    currency: 'TRY',
    limits: {
        groceries: 0,
        transport: 0,
        bills: 0,
        social: 0
    },
    goals: [],
    householdMembers: [
        { id: 'me', name: 'Ben', role: 'Ben' }
    ],
    householdExpenses: [],
    history: []
};

// Grafik Nesneleri (Canvas yeniden çizim hatalarını önlemek için)
let charts = {
    expensesDistribution: null,
    incomeVsExpense: null,
    savingsGauge: null,
    debtAmortization: null,
    strategyComparison: null,
    historyTrend: null,
    inflationProjection: null,
    householdDistribution: null
};

// Türkçe Ay İsimleri
const TURKISH_MONTHS = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];

// Döviz kuru dönüştürme katsayıları (Sabit Kur Tanımı)
// 1 USD = 33 TRY, 1 EUR = 36 TRY
const EXCHANGE_RATES = {
    TRY: 1,
    USD: 33,
    EUR: 36
};

// ==========================================================================
// YARDIMCI DÖVİZ DÖNÜŞÜM FONKSİYONLARI
// ==========================================================================
function toBaseCurrency(amount, fromCurrency) {
    if (fromCurrency === 'TRY') return amount;
    const rate = EXCHANGE_RATES[fromCurrency] || 1;
    return amount * rate;
}

function fromBaseCurrency(amountInTry, toCurrency) {
    if (toCurrency === 'TRY') return amountInTry;
    const rate = EXCHANGE_RATES[toCurrency] || 1;
    return amountInTry / rate;
}

function getCurrencySymbol(curr) {
    if (curr === 'USD') return '$';
    if (curr === 'EUR') return '€';
    return '₺';
}

function getCurrencyLocale(curr) {
    if (curr === 'USD') return 'en-US';
    if (curr === 'EUR') return 'de-DE';
    return 'tr-TR';
}

// ==========================================================================
// YARDIMCI TARİH VE BORÇ HESAPLAMA YORDAMLARI
// ==========================================================================
function getLocalYearMonth(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function getElapsedMonths(startDateStr, targetDateStr) {
    const [sYear, sMonth] = startDateStr.split("-").map(Number);
    const [tYear, tMonth] = targetDateStr.split("-").map(Number);
    return (tYear - sYear) * 12 + (tMonth - sMonth);
}

function getDebtRemainingPrincipal(debt, targetDate) {
    const todayStr = getLocalYearMonth(targetDate);
    const elapsed = getElapsedMonths(debt.startDate, todayStr);
    if (elapsed < 0) {
        return debt.amount;
    }
    if (elapsed >= debt.maturity) {
        return 0;
    }
    const P = debt.amount;
    const n = debt.maturity;
    const i = debt.interest / 100;
    if (i === 0) {
        return P * (1 - elapsed / n);
    } else {
        const numerator = Math.pow(1 + i, n) - Math.pow(1 + i, elapsed);
        const denominator = Math.pow(1 + i, n) - 1;
        return P * (numerator / denominator);
    }
}

function getDebtMonthlyPaymentAt(debt, targetDate) {
    const todayStr = getLocalYearMonth(targetDate);
    const elapsed = getElapsedMonths(debt.startDate, todayStr);
    if (elapsed >= 0 && elapsed < debt.maturity) {
        return debt.monthlyPayment;
    }
    return 0;
}

// Sayfa Yüklendiğinde Başlat
document.addEventListener("DOMContentLoaded", () => {
    initAuth(); // Bu fonksiyon checkAuth() üzerinden loadStateFromServer() asenkron veri yüklemesini tetikler.
    initNavigation();
    initCurrencySelector();
    initBudgetEventListeners();
    initLimitEventListeners();
    initGoalEventListeners();
    initDebtForm();
    initStrategyEventListeners();
    initCcTrapEventListeners();
    initInflationEventListeners();
    initHouseholdEventListeners();
    initResetDataButton();
    
    // Tarih alanını bugünle/bu ayla doldur
    const today = new Date();
    const currentMonthStr = getLocalYearMonth(today);
    const startDateInput = document.getElementById("input-debt-start-date");
    if (startDateInput) startDateInput.value = currentMonthStr;
    
    const goalDateInput = document.getElementById("input-goal-date");
    if (goalDateInput) {
        const futureDate = new Date();
        futureDate.setMonth(futureDate.getMonth() + 6);
        goalDateInput.value = getLocalYearMonth(futureDate);
    }
    
    // Üst bardaki tarihi güncelle
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const dateDisplay = document.getElementById("current-date-display");
    if (dateDisplay) dateDisplay.textContent = today.toLocaleDateString('tr-TR', options);
});

// ==========================================================================
// 1B. YEREL SUNUCU REST API CLIENT VE OTURUM YÖNETİMİ
// ==========================================================================
const API_BASE = 'http://localhost:3000/api';

function getAuthHeaders() {
    const token = localStorage.getItem("f360_auth_token") || "";
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    };
}

async function apiRequest(endpoint, method = "GET", body = null) {
    const url = API_BASE + endpoint;
    const options = {
        method: method,
        headers: getAuthHeaders()
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    try {
        const response = await fetch(url, options);
        if (response.status === 401) {
            handleAuthFailure();
            throw new Error("Oturum süresi dolmuş. Lütfen tekrar giriş yapın.");
        }
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || "İşlem gerçekleştirilemedi.");
        }
        return await response.json().catch(() => ({}));
    } catch (err) {
        console.error("API Hatası:", err);
        throw err;
    }
}

function handleAuthFailure() {
    localStorage.removeItem("f360_auth_token");
    localStorage.removeItem("f360_user_email");
    
    const loginScreen = document.getElementById("login-screen");
    const appContainer = document.querySelector(".app-container");
    if (loginScreen) loginScreen.style.display = "flex";
    if (appContainer) appContainer.style.display = "none";
}

function showAuthMessage(msg, type = "success") {
    const msgEl = document.getElementById("auth-message");
    if (msgEl) {
        msgEl.textContent = msg;
        msgEl.style.display = "block";
        if (type === "success") {
            msgEl.style.backgroundColor = "rgba(16, 185, 129, 0.15)";
            msgEl.style.color = "var(--color-success)";
            msgEl.style.border = "1px solid rgba(16, 185, 129, 0.3)";
        } else {
            msgEl.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
            msgEl.style.color = "var(--color-danger)";
            msgEl.style.border = "1px solid rgba(239, 68, 68, 0.3)";
        }
    }
}

let authMode = "login";

function toggleAuthMode() {
    const titleEl = document.getElementById("auth-title");
    const descEl = document.getElementById("auth-desc");
    const submitBtn = document.getElementById("btn-auth-submit");
    const helpTextEl = document.getElementById("auth-help-text");
    const toggleLink = document.getElementById("auth-toggle-link");
    const msgEl = document.getElementById("auth-message");
    
    if (msgEl) msgEl.style.display = "none";
    
    if (authMode === "login") {
        authMode = "register";
        if (titleEl) titleEl.textContent = "Yeni Hesap Oluşturun";
        if (descEl) descEl.textContent = "Finans360 sistemine kaydolun ve bütçe planlamanızı başlatın.";
        if (submitBtn) submitBtn.textContent = "Kayıt Ol";
        if (helpTextEl) helpTextEl.style.display = "none";
        if (toggleLink) toggleLink.textContent = "Zaten hesabınız var mı? Giriş Yapın";
    } else {
        authMode = "login";
        if (titleEl) titleEl.textContent = "Sisteme Giriş Yapın";
        if (descEl) descEl.textContent = "Finansal durumunuzu ve yaşam maliyetinizi yönetmeye başlamak için bilgilerinizi girin.";
        if (submitBtn) submitBtn.textContent = "Giriş Yap";
        if (helpTextEl) helpTextEl.style.display = "block";
        if (toggleLink) toggleLink.textContent = "Hesabınız yok mu? Kayıt Olun";
    }
}

function checkAuth() {
    const token = localStorage.getItem("f360_auth_token");
    const userEmail = localStorage.getItem("f360_user_email");
    const loginScreen = document.getElementById("login-screen");
    const appContainer = document.querySelector(".app-container");
    
    if (token) {
        if (loginScreen) loginScreen.style.display = "none";
        if (appContainer) appContainer.style.display = "flex";
        const userDisplay = document.getElementById("user-display");
        if (userDisplay) userDisplay.textContent = userEmail || "demo@finans360.com";
        
        loadStateFromServer();
    } else {
        if (loginScreen) loginScreen.style.display = "flex";
        if (appContainer) appContainer.style.display = "none";
    }
}

function initAuth() {
    checkAuth();
    
    const toggleLink = document.getElementById("auth-toggle-link");
    if (toggleLink) {
        toggleLink.addEventListener("click", (e) => {
            e.preventDefault();
            toggleAuthMode();
        });
    }
    
    const loginForm = document.getElementById("login-form");
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = document.getElementById("input-login-email").value.trim();
            const password = document.getElementById("input-login-password").value;
            const submitBtn = document.getElementById("btn-auth-submit");
            
            if (!email || !password) return;
            
            submitBtn.disabled = true;
            submitBtn.textContent = authMode === "login" ? "Giriş yapılıyor..." : "Kayıt olunuyor...";
            
            try {
                if (authMode === "login") {
                    const res = await apiRequest("/auth/login", "POST", { email, password });
                    localStorage.setItem("f360_auth_token", res.token);
                    localStorage.setItem("f360_user_email", res.email);
                    
                    document.getElementById("input-login-password").value = "";
                    const msgEl = document.getElementById("auth-message");
                    if (msgEl) msgEl.style.display = "none";
                    
                    checkAuth();
                } else {
                    await apiRequest("/auth/register", "POST", { email, password });
                    showAuthMessage("Hesabınız başarıyla oluşturuldu! Şimdi giriş yapabilirsiniz.", "success");
                    toggleAuthMode();
                    document.getElementById("input-login-password").value = "";
                }
            } catch (err) {
                showAuthMessage(err.message, "danger");
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = authMode === "login" ? "Giriş Yap" : "Kayıt Ol";
            }
        });
    }
    
    const logoutBtn = document.getElementById("btn-logout");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            try {
                await apiRequest("/auth/logout", "POST");
            } catch (err) {
                console.error("Logout hatası:", err);
            }
            localStorage.removeItem("f360_auth_token");
            localStorage.removeItem("f360_user_email");
            document.getElementById("input-login-password").value = "";
            checkAuth();
        });
    }
}

// ==========================================================================
// 2. NAVİGASYON (SAYFA GEÇİŞLERİ)
// ==========================================================================
function initNavigation() {
    const navLinks = document.querySelectorAll(".nav-link");
    const sections = document.querySelectorAll(".content-section");

    navLinks.forEach(link => {
        link.addEventListener("click", (e) => {
            e.preventDefault();
            const targetId = link.getAttribute("href").substring(1);

            // Aktif link sınıfını değiştir
            navLinks.forEach(l => l.classList.remove("active"));
            link.classList.add("active");

            // Aktif bölümü göster
            sections.forEach(section => {
                if (section.id === targetId) {
                    section.classList.add("active");
                } else {
                    section.classList.remove("active");
                }
            });

            // Grafiklerin düzgün boyutlanması için her geçişte güncelleme yap
            if (targetId === "section-dashboard" || targetId === "section-reports" || targetId === "section-strategy") {
                updateCharts();
            }
        });
    });
}

// ==========================================================================
// 3. ASENKRON VERİ YÜKLEME VE VERİTABANI GÜNCELLEME
// ==========================================================================
async function loadStateFromServer() {
    try {
        const data = await apiRequest("/state", "GET");
        
        STATE.budget = data.budget || {
            income: 0, rent: 0, groceries: 0, transport: 0, bills: 0,
            education: 0, health: 0, social: 0, others: 0
        };
        STATE.limits = data.limits || { groceries: 0, transport: 0, bills: 0, social: 0 };
        STATE.debts = data.debts || [];
        STATE.goals = data.goals || [];
        STATE.householdMembers = data.householdMembers || [{ id: 'me', name: 'Ben', role: 'Ben' }];
        STATE.householdExpenses = data.householdExpenses || [];
        STATE.history = data.history || [];
        
        // Form alanlarını doldur
        const curr = STATE.currency;
        const bInputs = {
            "input-monthly-income": STATE.budget.income,
            "input-rent": STATE.budget.rent,
            "input-groceries": STATE.budget.groceries,
            "input-transport": STATE.budget.transport,
            "input-bills": STATE.budget.bills,
            "input-education": STATE.budget.education,
            "input-health": STATE.budget.health,
            "input-social": STATE.budget.social,
            "input-others": STATE.budget.others
        };
        for (const [id, baseVal] of Object.entries(bInputs)) {
            const el = document.getElementById(id);
            if (el) {
                el.value = baseVal ? fromBaseCurrency(baseVal, curr).toFixed(0) : "";
            }
        }
        
        // Limit alanlarını doldur
        const lInputs = {
            "input-limit-groceries": STATE.limits.groceries,
            "input-limit-transport": STATE.limits.transport,
            "input-limit-bills": STATE.limits.bills,
            "input-limit-social": STATE.limits.social
        };
        for (const [id, baseVal] of Object.entries(lInputs)) {
            const el = document.getElementById(id);
            if (el) {
                el.value = baseVal ? fromBaseCurrency(baseVal, curr).toFixed(0) : "";
            }
        }
        
        // Ekstra ödeme input alanını doldur
        const savedExtraPayment = localStorage.getItem("f360_extra_payment");
        if (savedExtraPayment) {
            STATE.extraMonthlyPayment = parseFloat(savedExtraPayment) || 0;
            const extraInput = document.getElementById("input-strategy-extra-payment");
            if (extraInput) {
                extraInput.value = STATE.extraMonthlyPayment ? fromBaseCurrency(STATE.extraMonthlyPayment, curr).toFixed(0) : "";
            }
        }
        
        // Sayfa tercihi para birimini kur
        const savedCurrency = localStorage.getItem("f360_currency");
        if (savedCurrency) {
            STATE.currency = savedCurrency;
            const select = document.getElementById("currency-select");
            if (select) select.value = savedCurrency;
            
            // UI sembollerini güncelle
            const symbols = document.querySelectorAll(".currency-symbol");
            symbols.forEach(s => s.textContent = getCurrencySymbol(savedCurrency));
        }
        
        // Eğer veritabanında geçmiş veri yoksa mock veri tohumla
        if (STATE.history.length === 0) {
            await generateMockHistoryIfNeeded();
        }
        
        // Tabloları çiz
        renderDebtsTable();
        renderGoalsTable();
        renderHousehold();
        
        // Hesaplamaları yap ve grafikleri çiz
        calculateAll();
        
        // Kredi kartı faiz simülasyonunu da tetikle
        runCcTrapSimulation();
        
    } catch (err) {
        console.error("Veriler yüklenirken hata:", err);
    }
}

async function saveBudgetToLocalStorage() {
    try {
        await apiRequest("/budget", "POST", STATE.budget);
    } catch (err) {
        console.error("Bütçe kaydedilemedi:", err);
    }
}

async function saveDebtsToLocalStorage(debtToSave = null, deleteId = null) {
    try {
        if (deleteId) {
            await apiRequest("/debts/" + deleteId, "DELETE");
        } else if (debtToSave) {
            await apiRequest("/debts", "POST", debtToSave);
        } else {
            // Eğer parametresiz çağrıldıysa tüm diziyi senkronize et
            for (const d of STATE.debts) {
                await apiRequest("/debts", "POST", d);
            }
        }
    } catch (err) {
        console.error("Borç kaydedilemedi:", err);
    }
}

async function saveLimitsToLocalStorage() {
    try {
        await apiRequest("/limits", "POST", STATE.limits);
    } catch (err) {
        console.error("Limitler kaydedilemedi:", err);
    }
}

async function saveGoalsToLocalStorage(goalToSave = null, deleteId = null) {
    try {
        if (deleteId) {
            await apiRequest("/goals/" + deleteId, "DELETE");
        } else if (goalToSave) {
            await apiRequest("/goals", "POST", goalToSave);
        } else {
            for (const g of STATE.goals) {
                await apiRequest("/goals", "POST", g);
            }
        }
    } catch (err) {
        console.error("Hedefler kaydedilemedi:", err);
    }
}

async function saveHouseholdToLocalStorage(memberToSave = null, memberDeleteId = null, expenseToSave = null, expenseDeleteId = null) {
    try {
        if (memberDeleteId) {
            await apiRequest("/household/members/" + memberDeleteId, "DELETE");
        } else if (memberToSave) {
            await apiRequest("/household/members", "POST", memberToSave);
        }
        
        if (expenseDeleteId) {
            await apiRequest("/household/expenses/" + expenseDeleteId, "DELETE");
        } else if (expenseToSave) {
            await apiRequest("/household/expenses", "POST", expenseToSave);
        }
    } catch (err) {
        console.error("Hane verileri kaydedilemedi:", err);
    }
}

async function saveHistoryToLocalStorage() {
    try {
        await apiRequest("/history", "POST", STATE.history);
    } catch (err) {
        console.error("Geçmiş kaydedilemedi:", err);
    }
}

// ==========================================================================
// 4. HESAPLAMA OLAY DİNLEYİCİLERİ (BÜTÇE)
// ==========================================================================
function initBudgetEventListeners() {
    const budgetInputs = [
        "input-monthly-income", "input-rent", "input-groceries",
        "input-transport", "input-bills", "input-education",
        "input-health", "input-social", "input-others"
    ];

    budgetInputs.forEach(id => {
        const input = document.getElementById(id);
        const fieldName = id.replace("input-", "").replace("-", "");
        
        // Input event dinleyicisi ile anında hesaplama yap (girdi değerini dövizden taban para birimi olan TRY'ye çevirerek kaydet)
        input.addEventListener("input", () => {
            let val = parseFloat(input.value);
            if (isNaN(val) || val < 0) val = 0;
            
            const valInBase = toBaseCurrency(val, STATE.currency);
            
            // State alanını eşle
            if (fieldName === "monthlyincome") STATE.budget.income = valInBase;
            else if (fieldName === "rent") STATE.budget.rent = valInBase;
            else if (fieldName === "groceries") STATE.budget.groceries = valInBase;
            else if (fieldName === "transport") STATE.budget.transport = valInBase;
            else if (fieldName === "bills") STATE.budget.bills = valInBase;
            else if (fieldName === "education") STATE.budget.education = valInBase;
            else if (fieldName === "health") STATE.budget.health = valInBase;
            else if (fieldName === "social") STATE.budget.social = valInBase;
            else if (fieldName === "others") STATE.budget.others = valInBase;

            saveBudgetToLocalStorage();
            calculateAll();
        });
    });
}

// ==========================================================================
// 5. BORÇ VE KREDİ MANTIĞI & FORM İŞLEMLERİ
// ==========================================================================
function initDebtForm() {
    const form = document.getElementById("debt-form");
    const resetButton = document.getElementById("btn-reset-debt");

    if (!form) return;

    form.addEventListener("submit", (e) => {
        e.preventDefault();

        const id = document.getElementById("input-debt-id").value;
        const name = document.getElementById("input-debt-name").value.trim();
        const type = document.getElementById("input-debt-type").value;
        const amountVal = parseFloat(document.getElementById("input-debt-amount").value);
        const interest = parseFloat(document.getElementById("input-debt-interest").value);
        const maturity = parseInt(document.getElementById("input-debt-maturity").value);
        const startDate = document.getElementById("input-debt-start-date").value; // YYYY-MM

        if (isNaN(amountVal) || amountVal <= 0 || isNaN(interest) || interest < 0 || isNaN(maturity) || maturity <= 0 || !startDate) {
            alert("Lütfen tüm alanları geçerli değerlerle doldurun.");
            return;
        }

        // Girilen tutarı taban para birimine (TRY) çevir
        const amount = toBaseCurrency(amountVal, STATE.currency);

        // Taksit Hesaplama (Anüite / Eşit Taksitli Kredi Formülü)
        // Aylık Faiz Oranı i = interest / 100
        const i = interest / 100;
        let monthlyPayment = 0;

        if (i === 0) {
            monthlyPayment = amount / maturity;
        } else {
            monthlyPayment = amount * (i * Math.pow(1 + i, maturity)) / (Math.pow(1 + i, maturity) - 1);
        }

        const totalRepayment = monthlyPayment * maturity;
        const totalInterest = totalRepayment - amount;

        const debtData = {
            id: id || Date.now().toString(),
            name,
            type,
            amount, // Anapara (TRY)
            interest, // Aylık faiz oranı %
            maturity, // Ay sayısı
            startDate,
            monthlyPayment, // TRY
            totalRepayment, // TRY
            totalInterest // TRY
        };

        if (id) {
            // Düzenleme modu
            const index = STATE.debts.findIndex(d => d.id === id);
            if (index !== -1) STATE.debts[index] = debtData;
            STATE.editingDebtId = null;
            document.getElementById("btn-save-debt").textContent = "Krediyi Kaydet";
            resetButton.style.display = "none";
        } else {
            // Yeni borç ekleme
            STATE.debts.push(debtData);
        }

        saveDebtsToLocalStorage(debtData);
        form.reset();
        document.getElementById("input-debt-id").value = "";
        
        // Başlangıç tarihini tekrar bu aya sıfırla
        const today = new Date();
        document.getElementById("input-debt-start-date").value = getLocalYearMonth(today);

        renderDebtsTable();
        calculateAll();
    });

    if (resetButton) {
        resetButton.addEventListener("click", () => {
            form.reset();
            document.getElementById("input-debt-id").value = "";
            document.getElementById("btn-save-debt").textContent = "Krediyi Kaydet";
            resetButton.style.display = "none";
            STATE.editingDebtId = null;
            
            const today = new Date();
            document.getElementById("input-debt-start-date").value = getLocalYearMonth(today);
        });
    }
}

function renderDebtsTable() {
    const tbody = document.getElementById("debts-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (STATE.debts.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row">
                <td colspan="7" class="text-center text-muted">Kayıtlı borç bulunmamaktadır. Yeni borç ekleyebilirsiniz.</td>
            </tr>
        `;
        return;
    }

    STATE.debts.forEach(debt => {
        const today = new Date();
        const elapsed = getElapsedMonths(debt.startDate, getLocalYearMonth(today));
        let remainingMonthsLabel = "";
        let statusBadge = "";

        if (elapsed < 0) {
            remainingMonthsLabel = `${debt.maturity} Ay (Başlamadı)`;
            statusBadge = `<br><span class="badge" style="background: rgba(99, 102, 241, 0.1); color: #818cf8; border-color: rgba(99, 102, 241, 0.2); margin-top: 4px;">Başlamadı</span>`;
        } else if (elapsed >= debt.maturity) {
            remainingMonthsLabel = `0 / ${debt.maturity} Ay`;
            statusBadge = `<br><span class="badge" style="background: rgba(16, 185, 129, 0.1); color: var(--color-success); border-color: rgba(16, 185, 129, 0.2); margin-top: 4px;">Ödendi</span>`;
        } else {
            const remaining = debt.maturity - elapsed;
            remainingMonthsLabel = `${remaining} / ${debt.maturity} Ay`;
            statusBadge = `<br><span class="badge" style="background: rgba(245, 158, 11, 0.1); color: var(--color-warning); border-color: rgba(245, 158, 11, 0.2); margin-top: 4px;">Ödeniyor</span>`;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${escapeHtml(debt.name)}</strong>${statusBadge}</td>
            <td><span class="badge badge-type">${debt.type}</span></td>
            <td>${formatCurrency(debt.amount)}</td>
            <td class="text-danger font-weight-bold">${formatCurrency(debt.monthlyPayment)}</td>
            <td>${remainingMonthsLabel}</td>
            <td>%${debt.interest.toFixed(2)}</td>
            <td>
                <div class="table-actions">
                    <button class="btn-icon" onclick="editDebt('${debt.id}')" title="Düzenle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button class="btn-icon btn-icon-danger" onclick="deleteDebt('${debt.id}')" title="Sil">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function deleteDebt(id) {
    if (confirm("Bu borç/kredi kaydını silmek istediğinizden emin misiniz?")) {
        STATE.debts = STATE.debts.filter(d => d.id !== id);
        saveDebtsToLocalStorage(null, id);
        renderDebtsTable();
        calculateAll();
    }
}

function editDebt(id) {
    const debt = STATE.debts.find(d => d.id === id);
    if (!debt) return;

    document.getElementById("input-debt-id").value = debt.id;
    document.getElementById("input-debt-name").value = debt.name;
    document.getElementById("input-debt-type").value = debt.type;
    // Döviz cinsinden yükle
    document.getElementById("input-debt-amount").value = fromBaseCurrency(debt.amount, STATE.currency).toFixed(0);
    document.getElementById("input-debt-interest").value = debt.interest;
    document.getElementById("input-debt-maturity").value = debt.maturity;
    document.getElementById("input-debt-start-date").value = debt.startDate;

    document.getElementById("btn-save-debt").textContent = "Değişiklikleri Kaydet";
    document.getElementById("btn-reset-debt").style.display = "block";
    STATE.editingDebtId = id;

    // Borç formunun olduğu bölüme odaklan
    document.getElementById("nav-debts").click();
    document.getElementById("input-debt-name").focus();
}

// Global olarak window'a kaydet (inline HTML onclick uyumluluğu için)
window.editDebt = editDebt;
window.deleteDebt = deleteDebt;

// ==========================================================================
// 6. ANA FİNANSAL HESAPLAMALAR VE VERİ ENTEGRASYONU
// ==========================================================================
function calculateAll() {
    // A. Gelir
    const income = STATE.budget.income;

    // B. Aylık Borç Ödeme Toplamı
    let totalMonthlyDebtPayments = 0;
    let totalRemainingPrincipal = 0;
    let totalDebtRepayment = 0; // Faiz dahil kalan
    let totalDebtInterest = 0;
    let maxMaturityEndDate = null;

    const today = new Date();
    const todayStr = getLocalYearMonth(today);

    STATE.debts.forEach(debt => {
        // Bitiş tarihi hesapla
        const [year, month] = debt.startDate.split("-").map(Number);
        const endDate = new Date(year, month - 1 + debt.maturity, 1);
        if (!maxMaturityEndDate || endDate > maxMaturityEndDate) {
            maxMaturityEndDate = endDate;
        }

        // Aktif taksit ödemesi (bugün için)
        const currentPayment = getDebtMonthlyPaymentAt(debt, today);
        totalMonthlyDebtPayments += currentPayment;

        // Kalan anapara (bugün için)
        const remainingPrincipal = getDebtRemainingPrincipal(debt, today);
        totalRemainingPrincipal += remainingPrincipal;

        // Kalan toplam geri ödeme ve faiz yükü (bugün için)
        const elapsed = getElapsedMonths(debt.startDate, todayStr);
        if (elapsed < 0) {
            // Borç henüz başlamamışsa, tümü geri kalan borçtur
            totalDebtRepayment += debt.totalRepayment;
            totalDebtInterest += debt.totalInterest;
        } else if (elapsed < debt.maturity) {
            // Ödeme devam ediyorsa kalan taksit tutarları
            const remainingMonths = debt.maturity - elapsed;
            const remainingRepay = debt.monthlyPayment * remainingMonths;
            totalDebtRepayment += remainingRepay;
            totalDebtInterest += Math.max(0, remainingRepay - remainingPrincipal);
        }
    });

    // C. Yaşam Giderleri Toplamı (Bütçe girdileri + aylık borç ödemesi)
    const budgetExpenses = STATE.budget.rent + STATE.budget.groceries + 
                           STATE.budget.transport + STATE.budget.bills + 
                           STATE.budget.education + STATE.budget.health + 
                           STATE.budget.social + STATE.budget.others;

    const totalExpenses = budgetExpenses + totalMonthlyDebtPayments;

    // D. Kalan Bakiye
    const remainingBalance = income - totalExpenses;

    // E. Tasarruf Oranı (Kalan bakiye / Gelir)
    let savingsRate = 0;
    if (income > 0 && remainingBalance > 0) {
        savingsRate = (remainingBalance / income) * 100;
    }

    // F. Zorunlu Giderler Oranı
    const mandatoryExpenses = STATE.budget.rent + STATE.budget.groceries + 
                              STATE.budget.transport + STATE.budget.bills + 
                              STATE.budget.education + STATE.budget.health + 
                              totalMonthlyDebtPayments;
                              
    let mandatoryRatio = 0;
    if (income > 0) {
        mandatoryRatio = (mandatoryExpenses / income) * 100;
    }

    // G. Finansal Sağlık Skoru Hesapla
    let healthScore = calculateFinancialHealthScore(income, remainingBalance, savingsRate, totalMonthlyDebtPayments, mandatoryRatio);

    // H. Tasarruf Hedefleri Aylık İhtiyaç Hesaplaması ve Sağlık Skoru Etkisi
    let totalMonthlyRequiredSavings = 0;
    STATE.goals.forEach(goal => {
        const remMonths = getElapsedMonths(todayStr, goal.date);
        const divisor = remMonths <= 0 ? 1 : remMonths;
        totalMonthlyRequiredSavings += goal.amount / divisor;
    });

    if (totalMonthlyRequiredSavings > 0 && remainingBalance < totalMonthlyRequiredSavings) {
        const deficit = totalMonthlyRequiredSavings - remainingBalance;
        // Bütçe tasarruf açığına göre sağlık skorunu düşür (maks 15 puan ceza)
        const goalPenalty = Math.min(15, Math.round((deficit / totalMonthlyRequiredSavings) * 15));
        healthScore = Math.max(0, healthScore - goalPenalty);
    }

    // I. Kategori Limitleri Kontrolü ve Bildirim Paneli Yönetimi
    const alertsList = document.getElementById("alerts-list");
    const alertsPanel = document.getElementById("alerts-panel");
    let warnings = [];

    if (alertsList && alertsPanel) {
        alertsList.innerHTML = "";

        const limitChecks = [
            { name: "Market / Mutfak", value: STATE.budget.groceries, limit: STATE.limits.groceries },
            { name: "Ulaşım / Yakıt", value: STATE.budget.transport, limit: STATE.limits.transport },
            { name: "Faturalar", value: STATE.budget.bills, limit: STATE.limits.bills },
            { name: "Sosyal Yaşam", value: STATE.budget.social, limit: STATE.limits.social }
        ];

        limitChecks.forEach(c => {
            if (c.limit > 0) {
                const ratio = c.value / c.limit;
                if (ratio >= 1.0) {
                    warnings.push(`⚠️ <strong>${c.name}:</strong> Harcamanız aylık limiti <strong>%${(ratio*100).toFixed(0)}</strong> oranında aştı! (Limit: ${formatCurrency(c.limit)}, Harcanan: ${formatCurrency(c.value)})`);
                } else if (ratio >= 0.9) {
                    warnings.push(`⚠️ <strong>${c.name}:</strong> Harcamanız aylık limitin <strong>%${(ratio*100).toFixed(0)}</strong>'ına ulaştı. (Limit: ${formatCurrency(c.limit)}, Harcanan: ${formatCurrency(c.value)})`);
                }
            }
        });

        // Bütçe açığı uyarısı
        if (remainingBalance < 0) {
            warnings.push(`⚠️ <strong>Bütçe Açığı Uyarısı:</strong> Toplam giderleriniz gelirinizden fazla. Net aylık bütçe açığı: <strong>${formatCurrency(Math.abs(remainingBalance))}</strong>`);
        }

        // Hedef tasarruf açığı uyarısı
        if (totalMonthlyRequiredSavings > 0 && remainingBalance < totalMonthlyRequiredSavings) {
            const deficit = totalMonthlyRequiredSavings - remainingBalance;
            warnings.push(`🎯 <strong>Hedef Tasarruf Uyarısı:</strong> Tasarruf hedeflerinize ulaşabilmek için aylık ek <strong>${formatCurrency(deficit)}</strong> daha biriktirmeniz gerekmektedir.`);
        }

        if (warnings.length > 0) {
            alertsPanel.style.display = "block";
            warnings.forEach(w => {
                const li = document.createElement("li");
                li.innerHTML = w;
                alertsList.appendChild(li);
            });
        } else {
            alertsPanel.style.display = "none";
        }
    }

    // J. Finansal Risk Düzeyi Belirleme
    let riskLevel = "Düşük";
    let riskClass = "text-success";
    const debtToIncomeRatio = income > 0 ? (totalMonthlyDebtPayments / income) * 100 : 100;
    
    if (remainingBalance < 0 || debtToIncomeRatio > 45 || healthScore < 50) {
        riskLevel = "Yüksek";
        riskClass = "text-danger";
    } else if (remainingBalance === 0 || debtToIncomeRatio > 25 || healthScore < 70) {
        riskLevel = "Orta";
        riskClass = "text-warning";
    }

    // ==========================================
    // DOM GÜNCELLEMELERİ (DASHBOARD KARTLARI)
    // ==========================================
    document.getElementById("dash-total-income").textContent = formatCurrency(income);
    document.getElementById("dash-total-expense").textContent = formatCurrency(totalExpenses);
    document.getElementById("dash-remaining-balance").textContent = formatCurrency(remainingBalance);
    document.getElementById("dash-savings-rate").textContent = savingsRate.toFixed(1) + "%";
    document.getElementById("dash-risk-level").textContent = riskLevel;

    // Risk kartı stilleri
    const riskCard = document.getElementById("dash-risk-level");
    if (riskCard) {
        riskCard.className = "card-value " + riskClass;
    }

    const riskIconContainer = document.getElementById("risk-icon-container");
    if (riskIconContainer) {
        riskIconContainer.className = "card-icon risk-icon " + (riskLevel === "Yüksek" ? "text-danger" : riskLevel === "Orta" ? "text-warning" : "text-success");
    }

    // Tasarruf ilerleme barı
    const savingsProgressBar = document.getElementById("dash-savings-progress");
    if (savingsProgressBar) {
        savingsProgressBar.style.width = Math.min(savingsRate, 100) + "%";
        if (savingsRate >= 20) {
            savingsProgressBar.className = "progress-bar-fill fill-success";
        } else if (savingsRate >= 10) {
            savingsProgressBar.className = "progress-bar-fill fill-warning";
        } else {
            savingsProgressBar.className = "progress-bar-fill fill-danger";
        }
    }

    // Bakiye rengi ve simgesi
    const balanceValue = document.getElementById("dash-remaining-balance");
    const balanceIconContainer = document.getElementById("balance-icon-container");
    const balanceFooter = document.getElementById("dash-balance-footer");
    if (balanceValue && balanceIconContainer && balanceFooter) {
        if (remainingBalance >= 0) {
            balanceValue.className = "card-value text-success";
            balanceIconContainer.className = "card-icon balance-icon text-success";
            balanceFooter.innerHTML = '<span class="trend">Kullanılabilir tasarruf</span>';
        } else {
            balanceValue.className = "card-value text-danger";
            balanceIconContainer.className = "card-icon balance-icon text-danger";
            balanceFooter.innerHTML = '<span class="trend text-danger">Bütçe açığı var!</span>';
        }
    }

    // Zorunlu gider yüzdesi etiketi (Toplam gider kartı altında)
    const mandPctLabel = document.getElementById("dash-mandatory-percentage-label");
    if (mandPctLabel) {
        mandPctLabel.textContent = `Gelirin %${mandatoryRatio.toFixed(1)}'i zorunlu`;
        if (mandatoryRatio > 70) {
            mandPctLabel.className = "trend text-danger";
        } else if (mandatoryRatio > 50) {
            mandPctLabel.className = "trend text-warning";
        } else {
            mandPctLabel.className = "trend text-success";
        }
    }

    // ==========================================
    // DOM GÜNCELLEMELERİ (YAŞAM MALİYETİ BÖLÜMÜ ORANLARI)
    // ==========================================
    const ratioMandVal = document.getElementById("ratio-mandatory-val");
    const mandProgress = document.getElementById("ratio-mandatory-progress");
    const mandDesc = document.getElementById("ratio-mandatory-desc");
    if (ratioMandVal && mandProgress && mandDesc) {
        ratioMandVal.textContent = mandatoryRatio.toFixed(1) + "%";
        mandProgress.style.width = Math.min(mandatoryRatio, 100) + "%";
        if (mandatoryRatio > 65) {
            mandProgress.className = "progress-bar-fill fill-danger";
            mandDesc.textContent = "Dikkat: Zorunlu giderleriniz kritik düzeyde yüksek!";
        } else if (mandatoryRatio > 50) {
            mandProgress.className = "progress-bar-fill fill-warning";
            mandDesc.textContent = "Uyarı: Hedef sınırın (%50) hafif üzerindesiniz.";
        } else {
            mandProgress.className = "progress-bar-fill fill-success";
            mandDesc.textContent = "Tebrikler: Zorunlu gider oranınız dengeli ve sağlıklı.";
        }
    }

    const discretionaryExpenses = STATE.budget.social + STATE.budget.others;
    let discretionaryRatio = 0;
    if (income > 0) discretionaryRatio = (discretionaryExpenses / income) * 100;

    const ratioDiscVal = document.getElementById("ratio-discretionary-val");
    const discProgress = document.getElementById("ratio-discretionary-progress");
    const discDesc = document.getElementById("ratio-discretionary-desc");
    if (ratioDiscVal && discProgress && discDesc) {
        ratioDiscVal.textContent = discretionaryRatio.toFixed(1) + "%";
        discProgress.style.width = Math.min(discretionaryRatio, 100) + "%";
        if (discretionaryRatio > 35) {
            discProgress.className = "progress-bar-fill fill-danger";
            discDesc.textContent = "Dikkat: İsteğe bağlı harcamalarınız bütçenizi zorluyor.";
        } else if (discretionaryRatio > 25) {
            discProgress.className = "progress-bar-fill fill-warning";
            discDesc.textContent = "Uyarı: Harcamalarınızı kontrol altında tutmaya çalışın.";
        } else {
            discProgress.className = "progress-bar-fill fill-success";
            discDesc.textContent = "Tebrikler: İsteğe bağlı harcamalarınız kontrol altında.";
        }
    }

    // ==========================================
    // DOM GÜNCELLEMELERİ (BORÇ ÖZET)
    // ==========================================
    document.getElementById("debt-summary-total-principal").textContent = formatCurrency(totalRemainingPrincipal);
    document.getElementById("debt-summary-total-repayment").textContent = formatCurrency(totalDebtRepayment);
    document.getElementById("debt-summary-monthly-payment").textContent = formatCurrency(totalMonthlyDebtPayments);
    document.getElementById("debt-summary-total-interest").textContent = formatCurrency(totalDebtInterest);
    
    const debtSummaryEndDate = document.getElementById("debt-summary-end-date");
    if (debtSummaryEndDate) {
        if (maxMaturityEndDate) {
            const monthName = TURKISH_MONTHS[maxMaturityEndDate.getMonth()];
            const yearVal = maxMaturityEndDate.getFullYear();
            debtSummaryEndDate.textContent = `${monthName} ${yearVal}`;
        } else {
            debtSummaryEndDate.textContent = "-";
        }
    }

    // ==========================================
    // DOM GÜNCELLEMELERİ (FİNANSAL SAĞLIK SKORU)
    // ==========================================
    document.getElementById("health-score-value").textContent = healthScore;
    
    let healthStatus = "Hesaplanıyor";
    let healthColorClass = "text-muted";
    let healthStrokeColor = "rgba(255, 255, 255, 0.2)";
    let healthDesc = "";

    if (income > 0) {
        if (healthScore >= 90) {
            healthStatus = "Çok İyi";
            healthColorClass = "text-success";
            healthStrokeColor = "var(--color-success)";
            healthDesc = "Finansal yapınız son derece sağlam. Düşük riskli, yüksek tasarruflu ve dengeli bir bütçeniz var. Tebrikler!";
        } else if (healthScore >= 70) {
            healthStatus = "İyi";
            healthColorClass = "text-success";
            healthStrokeColor = "#10b981"; 
            healthDesc = "Bütçeniz sağlıklı durumda. Tasarruf yapabiliyor ve borçlarınızı kolayca yönetebiliyorsunuz. Aynen devam!";
        } else if (healthScore >= 50) {
            healthStatus = "Orta";
            healthColorClass = "text-warning";
            healthStrokeColor = "var(--color-warning)";
            healthDesc = "Finansal sağlığınız dengede fakat geliştirmeye açık. Borç yükünü azaltarak veya tasarruf oranınızı biraz artırarak daha güvenli bir alana geçebilirsiniz.";
        } else {
            healthStatus = "Riskli";
            healthColorClass = "text-danger";
            healthStrokeColor = "var(--color-danger)";
            healthDesc = "Finansal yapınızda riskler mevcut. Bütçe açığınız olabilir, borç yükünüz çok yüksek veya tasarruf yapamıyor olabilirsiniz. Acil önlem almanız gerekebilir.";
        }
    } else {
        healthDesc = "Finansal sağlık puanınızı hesaplamak için lütfen Aylık Gelir bilginizi girin.";
    }

    const healthStatusLabel = document.getElementById("health-status-label");
    if (healthStatusLabel) {
        healthStatusLabel.textContent = healthStatus;
        healthStatusLabel.className = "gauge-status " + healthColorClass;
    }
    const healthDescLabel = document.getElementById("health-desc-label");
    if (healthDescLabel) {
        healthDescLabel.textContent = healthDesc;
    }

    // SVG Dairesini Güncelle (Çevre = 251.32)
    const gaugeFill = document.getElementById("health-gauge-fill");
    if (gaugeFill) {
        const strokeDashOffset = 251.32 - (251.32 * healthScore / 100);
        gaugeFill.style.strokeDashoffset = strokeDashOffset;
        gaugeFill.style.stroke = healthStrokeColor;
    }
    
    // ==========================================
    // DİNAMİK YORUMLAR (AKILLI FİNANSAL ANALİZ)
    // ==========================================
    generateSmartAnalysis(income, totalExpenses, remainingBalance, savingsRate, totalMonthlyDebtPayments, mandatoryRatio, healthScore, riskLevel, totalMonthlyRequiredSavings);

    // ==========================================
    // GRAFİKLERİ YENİLE
    // ==========================================
    updateCharts();
}

// ==========================================================================
// 7. FİNANSAL SAĞLIK SKORU ALGORİTMASI
// ==========================================================================
function calculateFinancialHealthScore(income, balance, savingsRate, monthlyDebt, mandatoryRatio) {
    if (income <= 0) return 0;

    let score = 0;

    // 1. Tasarruf Oranı Skoru (Maks 35 Puan)
    if (savingsRate >= 25) {
        score += 35;
    } else if (savingsRate >= 15) {
        // 15-25 arası lineer: 25 puandan 35 puana
        score += 25 + ((savingsRate - 15) / 10) * 10;
    } else if (savingsRate >= 5) {
        // 5-15 arası lineer: 10 puandan 25 puana
        score += 10 + ((savingsRate - 5) / 10) * 15;
    } else if (savingsRate > 0) {
        // 0-5 arası lineer: 2 puandan 10 puana
        score += 2 + (savingsRate / 5) * 8;
    } else if (balance === 0) {
        score += 2;
    }
    // Eksi bakiyede tasarruf puanı 0

    // 2. Borç/Gelir Oranı Skoru (Maks 30 Puan)
    const debtRatio = (monthlyDebt / income) * 100;
    if (monthlyDebt === 0) {
        score += 30; // Borçsuz olmak artı puandır
    } else if (debtRatio <= 10) {
        score += 28;
    } else if (debtRatio <= 25) {
        // 10-25 arası lineer: 20 puandan 28 puana
        score += 20 + ((25 - debtRatio) / 15) * 8;
    } else if (debtRatio <= 40) {
        // 25-40 arası lineer: 8 puandan 20 puana
        score += 8 + ((40 - debtRatio) / 15) * 12;
    } else if (debtRatio <= 50) {
        // 40-50 arası lineer: 2 puandan 8 puana
        score += 2 + ((50 - debtRatio) / 10) * 6;
    }

    // 3. Zorunlu Gider Oranı Skoru (Maks 20 Puan)
    if (mandatoryRatio <= 40) {
        score += 20;
    } else if (mandatoryRatio <= 60) {
        // 40-60 arası lineer: 10 puandan 20 puana
        score += 10 + ((60 - mandatoryRatio) / 20) * 10;
    } else if (mandatoryRatio <= 80) {
        // 60-80 arası lineer: 2 puandan 10 puana
        score += 2 + ((80 - mandatoryRatio) / 20) * 8;
    }

    // 4. Likidite ve Bakiye Skoru (Maks 15 Puan)
    if (balance > 15000) {
        score += 15;
    } else if (balance > 5000) {
        // 5000 - 15000 arası lineer: 8 puandan 15 puana
        score += 8 + ((balance - 5000) / 10000) * 7;
    } else if (balance > 0) {
        // 0 - 5000 arası lineer: 2 puandan 8 puana
        score += 2 + (balance / 5000) * 6;
    }

    return Math.min(Math.round(score), 100);
}

// ==========================================================================
// 8. AKILLI ANALİZ VE TÜRKÇE ÖNERİ MOTORU
// ==========================================================================
function generateSmartAnalysis(income, totalExpenses, balance, savingsRate, monthlyDebt, mandatoryRatio, healthScore, riskLevel, totalMonthlyRequiredSavings = 0) {
    const container = document.getElementById("smart-analysis-container");
    if (!container) return;
    container.innerHTML = "";

    if (income <= 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                <p>Analiz ve öneriler için aylık net gelirinizi girin.</p>
            </div>
        `;
        return;
    }

    const tips = [];
    const mandatoryExpenses = income * (mandatoryRatio / 100);

    // Öneri 1: Bütçe Açığı Durumu
    if (balance < 0) {
        tips.push({
            type: "danger",
            text: `<strong>Bütçe Açığı Uyarısı:</strong> Aylık toplam giderleriniz gelirinizden <strong>${formatCurrency(Math.abs(balance))}</strong> daha fazladır. Geliriniz harcamalarınızı karşılamıyor. Acilen harcamalarınızı (özellikle isteğe bağlı) kısmalı veya ek gelir imkânlarını değerlendirmelisiniz.`
        });
    }

    // Öneri 2: Zorunlu Gider Oranı Analizi
    if (mandatoryRatio > 65) {
        tips.push({
            type: "danger",
            text: `Gelirinizin <strong>%${mandatoryRatio.toFixed(1)}</strong>'i kira, fatura, market gibi zorunlu giderlerinize ve kredi taksitlerinize gitmektedir. İdeal seviye olan %50 sınırının üzerindesiniz. Bu durum acil durumlara karşı bütçenizi çok kırılgan hale getirmektedir. Mutfak, fatura veya kira maliyetlerinizi düşürme yollarını arayın.`
        });
    } else if (mandatoryRatio > 50) {
        tips.push({
            type: "warning",
            text: `Zorunlu harcamalarınız gelirinizin <strong>%${mandatoryRatio.toFixed(1)}</strong> düzeyindedir. İdeal finansal denge için bu oranı %50 seviyesinin altına çekmeye çalışmalısınız.`
        });
    } else {
        tips.push({
            type: "success",
            text: `Zorunlu harcamalarınız (%${mandatoryRatio.toFixed(1)}), gelirinizin yarısından azını oluşturmaktadır. Bu oran finansal esneklik açısından oldukça sağlıklıdır.`
        });
    }

    // Öneri 3: Tasarruf Oranı Analizi
    if (balance >= 0) {
        if (savingsRate < 10) {
            tips.push({
                type: "warning",
                text: `Tasarruf oranınız (%${savingsRate.toFixed(1)}) çok düşük seviyededir. Finansal güvenceniz için gelirinizin en az %15-%20'sini tasarruf etmeli ve acil durum fonu oluşturmalısınız.`
            });
        } else if (savingsRate >= 20) {
            tips.push({
                type: "success",
                text: `Tasarruf oranınız (%${savingsRate.toFixed(1)}) mükemmel düzeydedir! Bu düzenli birikim, yatırımlarınızın büyümesini ve finansal bağımsızlığınızı hızlandıracaktır. Birikimlerinizi enflasyona karşı korumak için yatırım araçlarını araştırabilirsiniz.`
            });
        } else {
            tips.push({
                type: "success",
                text: `Tasarruf oranınız (%${savingsRate.toFixed(1)}) iyi seviyededir. Tasarruflarınızı daha da optimize etmek için isteğe bağlı harcamalarınızı gözden geçirebilirsiniz.`
            });
        }
    }

    // Öneri 4: Borç ve Kredi Yükü Analizi
    const debtRatio = (monthlyDebt / income) * 100;
    if (monthlyDebt > 0) {
        if (debtRatio > 35) {
            tips.push({
                type: "danger",
                text: `Aylık borç ve kredi taksit ödemeleriniz gelirinizin <strong>%${debtRatio.toFixed(1)}</strong>'ini kapsamaktadır. Bu oran kritik sınırı (%35) aşmıştır. Yeni kredi almaktan kesinlikle kaçınmalı, borçlarınızı yapılandırma veya erken kapatma yöntemleri ile küçültmelisiniz.`
            });
        } else if (debtRatio > 15) {
            tips.push({
                type: "warning",
                text: `Aylık taksit ödemelerinizin gelire oranı %${debtRatio.toFixed(1)} düzeyindedir. Yönetilebilir olsa da yeni borçlar eklemek bütçenizi riske sokabilir. Borç eritmeye odaklanmak faydalı olacaktır.`
            });
        } else {
            tips.push({
                type: "success",
                text: `Kredi ödemelerinizin gelire oranı %${debtRatio.toFixed(1)} ile güvenli bölgededir (%15'in altında). Bütçenizi sarsmayan, kontrol altında bir borç yapısına sahipsiniz.`
            });
        }
    } else {
        tips.push({
            type: "success",
            text: `Tebrikler, kayıtlı aktif borcunuz bulunmamaktadır! Aylık taksit ödemeniz olmadığı için gelirinizin tamamını bütçeniz ve birikimleriniz doğrultusunda özgürce yönetebilirsiniz.`
        });
    }

    // Öneri 5: Finansal Sağlık & Acil Durum Fonu Önerisi
    if (healthScore < 50) {
        tips.push({
            type: "danger",
            text: `<strong>Finansal Sağlık Uyarısı:</strong> Finansal sağlık skorunuz <strong>${healthScore}</strong> (Riskli) düzeyindedir. Acil durum fonunuz yoksa, kendinizi en az 3-6 aylık zorunlu giderleriniz kadar (yaklaşık ${formatCurrency(mandatoryExpenses * 3)}) birikim yapmaya adamalısınız. Lüks harcamaları askıya alıp borçları azaltmaya öncelik verin.`
        });
    } else if (healthScore >= 70 && healthScore < 90) {
        tips.push({
            type: "success",
            text: `Finansal sağlık skorunuz <strong>${healthScore}</strong> (İyi) düzeyindedir. Bütçeniz istikrarlı. Yatırım portföyünüzü çeşitlendirerek uzun vadeli servetinizi artırmaya odaklanabilirsiniz.`
        });
    }

    // Öneri 6: Hedef Tasarruf Analizi
    if (totalMonthlyRequiredSavings > 0) {
        if (balance < totalMonthlyRequiredSavings) {
            const deficit = totalMonthlyRequiredSavings - balance;
            tips.push({
                type: "danger",
                text: `<strong>Hedef Tasarruf Açığı:</strong> Planladığınız tasarruf hedeflerine zamanında ulaşmak için aylık toplam <strong>${formatCurrency(totalMonthlyRequiredSavings)}</strong> biriktirmeniz gerekiyor. Ancak şu anki tasarruf kapasiteniz (${formatCurrency(balance)}) bu hedefin <strong>${formatCurrency(deficit)}</strong> gerisindedir. Hedef sürelerinizi uzatmayı veya zorunlu olmayan giderlerinizi kısmayı düşünebilirsiniz.`
            });
        } else {
            tips.push({
                type: "success",
                text: `Tebrikler! Aylık tasarruflarınız (${formatCurrency(balance)}), tüm tasarruf hedefleriniz için gereken aylık birikim tutarını (${formatCurrency(totalMonthlyRequiredSavings)}) karşılayabilecek seviyededir.`
            });
        }
    }

    // Listeyi Oluştur ve DOM'a ekle
    const ul = document.createElement("ul");
    ul.className = "analysis-list";

    tips.forEach(tip => {
        const li = document.createElement("li");
        li.className = "analysis-item";
        
        let iconColor = "var(--color-success)";
        let iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="analysis-item-icon"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
        
        if (tip.type === "danger") {
            iconColor = "var(--color-danger)";
            iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="analysis-item-icon"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
        } else if (tip.type === "warning") {
            iconColor = "var(--color-warning)";
            iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="analysis-item-icon"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
        }

        li.innerHTML = `
            <div style="color: ${iconColor}">${iconSvg}</div>
            <div>${tip.text}</div>
        `;
        ul.appendChild(li);
    });

    container.appendChild(ul);
}

// ==========================================================================
// 9. DİNAMİK CHART.JS ENTEGRASYONLARI
// ==========================================================================
// updateCharts() is defined at the end of the file to include history and inflation charts.

function drawExpensesDistributionChart() {
    const ctx = document.getElementById("chart-expenses-distribution");
    if (!ctx) return;

    const dataValues = [
        STATE.budget.rent,
        STATE.budget.groceries,
        STATE.budget.transport,
        STATE.budget.bills,
        STATE.budget.education,
        STATE.budget.health,
        STATE.budget.social,
        STATE.budget.others
    ];

    // Aktif kredi taksit ödemelerini de gider pastasına ekle
    let totalMonthlyDebt = 0;
    const today = new Date();
    STATE.debts.forEach(d => totalMonthlyDebt += getDebtMonthlyPaymentAt(d, today));
    dataValues.push(totalMonthlyDebt);

    const labels = [
        "Kira / Konut",
        "Market / Mutfak",
        "Ulaşım / Yakıt",
        "Faturalar",
        "Eğitim Giderleri",
        "Sağlık Giderleri",
        "Sosyal Yaşam",
        "Diğer Giderler",
        "Aylık Borç Ödemeleri"
    ];

    // Sadece sıfırdan büyük olan harcamaları göster
    const filteredLabels = [];
    const filteredData = [];
    const colorPalette = [
        "#f43f5e", // Kira (Gül Kırmızı)
        "#fb7185", // Market
        "#fda4af", // Ulaşım
        "#ff8a00", // Fatura (Turuncu)
        "#ffae19", // Eğitim
        "#ffd000", // Sağlık
        "#a78bfa", // Sosyal Yaşam (Mor)
        "#cbd5e1", // Diğer (Gri)
        "#6366f1"  // Borç Ödemeleri (İndigo)
    ];
    const filteredColors = [];

    dataValues.forEach((val, index) => {
        if (val > 0) {
            filteredData.push(val);
            filteredLabels.push(labels[index]);
            filteredColors.push(colorPalette[index]);
        }
    });

    if (charts.expensesDistribution) {
        charts.expensesDistribution.destroy();
    }

    if (filteredData.length === 0) {
        // Boş grafik durumu için varsayılan çiz
        charts.expensesDistribution = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ["Veri Yok"],
                datasets: [{
                    data: [1],
                    backgroundColor: ["rgba(255,255,255,0.05)"],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }

    charts.expensesDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: filteredLabels,
            datasets: [{
                data: filteredData,
                backgroundColor: filteredColors,
                borderWidth: 1,
                borderColor: "#0b0d15",
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#9ca3af',
                        font: { size: 11, family: 'Plus Jakarta Sans' },
                        boxWidth: 12
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percent = ((val / total) * 100).toFixed(1);
                            return `${context.label}: ${formatCurrency(val)} (%${percent})`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

function drawIncomeVsExpenseChart() {
    const ctx = document.getElementById("chart-income-vs-expense");
    if (!ctx) return;

    const income = fromBaseCurrency(STATE.budget.income, STATE.currency);
    let budgetExpenses = STATE.budget.rent + STATE.budget.groceries + 
                           STATE.budget.transport + STATE.budget.bills + 
                           STATE.budget.education + STATE.budget.health + 
                           STATE.budget.social + STATE.budget.others;
    let monthlyDebt = 0;
    const today = new Date();
    STATE.debts.forEach(d => monthlyDebt += getDebtMonthlyPaymentAt(d, today));

    const totalExpenses = fromBaseCurrency(budgetExpenses + monthlyDebt, STATE.currency);
    const savings = Math.max(0, income - totalExpenses);

    if (charts.incomeVsExpense) {
        charts.incomeVsExpense.destroy();
    }

    const symbol = getCurrencySymbol(STATE.currency);
    const locale = getCurrencyLocale(STATE.currency);

    charts.incomeVsExpense = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ["Gelir", "Gider (Harcama + Borç)", "Tasarruf Potansiyeli"],
            datasets: [{
                data: [income, totalExpenses, savings],
                backgroundColor: [
                    "rgba(16, 185, 129, 0.8)",  // Gelir Yeşil
                    "rgba(244, 63, 94, 0.8)",   // Gider Kırmızı
                    "rgba(99, 102, 241, 0.8)"   // Tasarruf İndigo
                ],
                borderColor: [
                    "var(--color-success)",
                    "var(--color-danger)",
                    "var(--color-primary)"
                ],
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.raw.toLocaleString(locale) + ' ' + symbol;
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.04)" },
                    ticks: {
                        color: "#9ca3af",
                        font: { family: 'Plus Jakarta Sans', size: 10 },
                        callback: function(value) {
                            return value.toLocaleString(locale) + ' ' + symbol;
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: "#9ca3af", font: { family: 'Plus Jakarta Sans', size: 11 } }
                }
            }
        }
    });
}

function drawSavingsGaugeChart() {
    const ctx = document.getElementById("chart-savings-gauge");
    if (!ctx) return;

    const income = STATE.budget.income;
    let budgetExpenses = STATE.budget.rent + STATE.budget.groceries + 
                           STATE.budget.transport + STATE.budget.bills + 
                           STATE.budget.education + STATE.budget.health + 
                           STATE.budget.social + STATE.budget.others;
    let monthlyDebt = 0;
    const today = new Date();
    STATE.debts.forEach(d => monthlyDebt += getDebtMonthlyPaymentAt(d, today));
    const totalExpenses = budgetExpenses + monthlyDebt;
    const remainingBalance = income - totalExpenses;

    let savingsRate = 0;
    if (income > 0 && remainingBalance > 0) {
        savingsRate = (remainingBalance / income) * 100;
    }

    const maxGaugeVal = 40; // Hedef tavan oranı grafikte %40 olsun
    const scoreVal = Math.min(savingsRate, maxGaugeVal);
    const remainingVal = Math.max(0, maxGaugeVal - scoreVal);

    let gaugeColor = "rgba(244, 63, 94, 0.85)"; // Kırmızı (<%10)
    let textStatus = "Tasarruf oranınız çok düşük seviyededir.";

    if (savingsRate >= 20) {
        gaugeColor = "rgba(16, 185, 129, 0.85)"; // Yeşil (>=%20)
        textStatus = `Tasarruf oranınız %${savingsRate.toFixed(1)} ile harika seviyededir!`;
    } else if (savingsRate >= 10) {
        gaugeColor = "rgba(245, 158, 11, 0.85)"; // Sarı (>=%10)
        textStatus = `Tasarruf oranınız %${savingsRate.toFixed(1)} düzeyindedir. Hedef en az %20.`;
    } else if (remainingBalance <= 0) {
        textStatus = "Bütçeniz açık vermektedir veya tasarruf yapılamamaktadır!";
    }

    document.getElementById("savings-gauge-status-text").innerHTML = `<span style="color: ${gaugeColor === 'rgba(16, 185, 129, 0.85)' ? 'var(--color-success)' : gaugeColor === 'rgba(245, 158, 11, 0.85)' ? 'var(--color-warning)' : 'var(--color-danger)'}">${textStatus}</span>`;

    if (charts.savingsGauge) {
        charts.savingsGauge.destroy();
    }

    charts.savingsGauge = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ["Tasarruf Oranı", "Kalan Hedef"],
            datasets: [{
                data: [scoreVal, remainingVal],
                backgroundColor: [gaugeColor, "rgba(255, 255, 255, 0.03)"],
                borderWidth: 1,
                borderColor: "#0b0d15"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            rotation: -90,
            circumference: 180,
            cutout: '80%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.dataIndex === 0) {
                                return `Tasarruf Oranı: %${savingsRate.toFixed(1)}`;
                            }
                            return `Kalan Hedef (Hedef %${maxGaugeVal}+)`;
                        }
                    }
                }
            }
        }
    });
}

function drawDebtAmortizationChart() {
    const ctx = document.getElementById("chart-debt-amortization");
    if (!ctx) return;

    if (STATE.debts.length === 0) {
        // Borç yoksa boş grafik çiz
        if (charts.debtAmortization) {
            charts.debtAmortization.destroy();
        }
        charts.debtAmortization = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ["Bugün"],
                datasets: [{
                    label: "Toplam Borç",
                    data: [0],
                    backgroundColor: "rgba(244, 63, 94, 0.05)",
                    borderColor: "rgba(244, 63, 94, 0.2)",
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
        return;
    }

    // 1. En erken başlangıç tarihini ve en geç bitiş tarihini bul
    let minStartDate = null;
    let maxEndDate = null;

    STATE.debts.forEach(debt => {
        const [sYear, sMonth] = debt.startDate.split("-").map(Number);
        const sDate = new Date(sYear, sMonth - 1, 1);
        const eDate = new Date(sYear, sMonth - 1 + debt.maturity, 1);

        if (!minStartDate || sDate < minStartDate) minStartDate = sDate;
        if (!maxEndDate || eDate > maxEndDate) maxEndDate = eDate;
    });

    // 2. Bugünün tarihini de dahil ederek aylık bir zaman serisi oluştur
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Başlangıç noktasını her zaman bugünden başlatarak geleceğe yönelik projeksiyonu gösterelim
    let startPoint = todayStart;
    
    const timeline = [];
    let currentPoint = new Date(startPoint.getFullYear(), startPoint.getMonth(), 1);

    while (currentPoint <= maxEndDate) {
        timeline.push(new Date(currentPoint));
        currentPoint.setMonth(currentPoint.getMonth() + 1);
    }

    // Maksimum gösterim 60 ay (5 yıl) olsun, grafik kirlenmesin
    const displayTimeline = timeline.slice(0, 60);

    // 3. Her bir zaman noktası için toplam kalan borç anaparasını hesapla
    const dataPoints = [];
    const todayStr = getLocalYearMonth(today);

    displayTimeline.forEach(timePoint => {
        let totalPrincipalRemainingAtThisMonth = 0;

        STATE.debts.forEach(debt => {
            const [sYear, sMonth] = debt.startDate.split("-").map(Number);
            const debtStartDate = new Date(sYear, sMonth - 1, 1);
            
            // Bu borcun bu aydan kaç ay sonra biteceğini hesapla
            // Fark ay sayısı = (timePoint.year - sYear)*12 + (timePoint.month - sMonth)
            const elapsedMonths = (timePoint.getFullYear() - debtStartDate.getFullYear()) * 12 + (timePoint.getMonth() - debtStartDate.getMonth());

            if (elapsedMonths < 0) {
                // Kredi henüz başlamamışsa kalan borç orijinal anaparadır
                totalPrincipalRemainingAtThisMonth += debt.amount;
            } else if (elapsedMonths >= debt.maturity) {
                // Kredi bitmişse kalan borç 0'dır
                totalPrincipalRemainingAtThisMonth += 0;
            } else {
                // Kredi devam ediyorsa, elapsedMonths kadar taksit ödenmiştir.
                // Kalan borç anapara formülü (Amortisman):
                // P_rem = P * [ (1+i)^n - (1+i)^m ] / [ (1+i)^n - 1 ]
                const P = debt.amount;
                const n = debt.maturity;
                const m = elapsedMonths;
                const i = debt.interest / 100;

                if (i === 0) {
                    totalPrincipalRemainingAtThisMonth += P * (1 - m / n);
                } else {
                    const numerator = Math.pow(1 + i, n) - Math.pow(1 + i, m);
                    const denominator = Math.pow(1 + i, n) - 1;
                    totalPrincipalRemainingAtThisMonth += P * (numerator / denominator);
                }
            }
        });

        // Grafik anapara verilerini döviz cinsine çevirerek ekle
        dataPoints.push(Math.round(fromBaseCurrency(totalPrincipalRemainingAtThisMonth, STATE.currency)));
    });

    // 4. Etiketleri formatla ("Haziran 2026")
    const labels = displayTimeline.map(timePoint => {
        return `${TURKISH_MONTHS[timePoint.getMonth()]} ${timePoint.getFullYear()}`;
    });

    if (charts.debtAmortization) {
        charts.debtAmortization.destroy();
    }

    const symbol = getCurrencySymbol(STATE.currency);
    const locale = getCurrencyLocale(STATE.currency);

    charts.debtAmortization = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: "Kalan Toplam Anapara",
                data: dataPoints,
                borderColor: "rgba(244, 63, 94, 0.85)", // Gül Kırmızısı (Gider & Borç Rengi)
                backgroundColor: "rgba(244, 63, 94, 0.05)",
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                pointRadius: dataPoints.length > 24 ? 0 : 3, // Çok nokta varsa noktaları gizle, sade dursun
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Kalan Borç: ${context.raw.toLocaleString(locale)} ${symbol}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.04)" },
                    ticks: {
                        color: "#9ca3af",
                        font: { family: 'Plus Jakarta Sans', size: 10 },
                        callback: function(value) {
                            return value.toLocaleString(locale) + ' ' + symbol;
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: "#9ca3af",
                        font: { family: 'Plus Jakarta Sans', size: 10 },
                        maxTicksLimit: 12 // Çok fazla etiket sıkışmasını önle
                    }
                }
            }
        }
    });
}

// ==========================================================================
// 10. YARDIMCI BİÇİMLENDİRME VE GÜVENLİK FONKSİYONLARI
// ==========================================================================
function formatCurrency(val) {
    if (isNaN(val)) val = 0;
    const curr = STATE.currency || 'TRY';
    const converted = fromBaseCurrency(val, curr);
    const locale = getCurrencyLocale(curr);
    return new Intl.NumberFormat(locale, { style: 'currency', currency: curr }).format(converted);
}

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// ==========================================================================
// 11. BORÇ ÖDEME STRATEJİLERİ (KARTOPU VE ÇIĞ) SİMÜLASYONU
// ==========================================================================
function initStrategyEventListeners() {
    const inputExtra = document.getElementById("input-strategy-extra-payment");
    if (inputExtra) {
        inputExtra.addEventListener("input", () => {
            let val = parseFloat(inputExtra.value);
            if (isNaN(val) || val < 0) val = 0;
            STATE.extraMonthlyPayment = val;
            localStorage.setItem("f360_extra_payment", val);
            calculateAll();
        });
    }
}

function simulateDebtPayoff(debtsInput, extraMonthlyPayment = 0, strategy = 'avalanche') {
  let debts = debtsInput.map(d => ({ ...d, remaining: d.balance }));
  const monthlySchedule = [];
  const payoffOrder = [];

  let month = 0;
  let totalInterestPaid = 0;
  let totalPaid = 0;
  let freedUpPayment = 0; // tamamen ödenen kredilerden boşalan minimum taksitler bir sonraki hedefe akar

  const MAX_MONTHS = 600; // 50 yıl güvenlik sınırı (sonsuz döngü engeli)

  while (debts.some(d => d.remaining > 0.01) && month < MAX_MONTHS) {
    month++;

    // 1) Her aktif borca bu ayın faizini işle + minimum taksiti düş
    debts.forEach(d => {
      if (d.remaining <= 0.01) return;
      const monthlyRate = d.annualRate / 12;
      const interest = d.remaining * monthlyRate;
      d.remaining += interest;
      totalInterestPaid += interest;

      const payment = Math.min(d.minPayment, d.remaining);
      d.remaining -= payment;
      totalPaid += payment;
    });

    // 2) Bu ayki ekstra bütçeyi (kullanıcı bütçesi + boşalan minimumlar) stratejiye göre sırala ve hedefe ak
    const active = debts.filter(d => d.remaining > 0.01);
    const priorityOrder = [...active].sort((a, b) =>
      strategy === 'snowball'
        ? a.remaining - b.remaining   // Kartopu: en küçük bakiye önce
        : b.annualRate - a.annualRate // Çığ: en yüksek faiz önce
    );

    let availableExtra = extraMonthlyPayment + freedUpPayment;
    for (const target of priorityOrder) {
      if (availableExtra <= 0) break;
      const debtRef = debts.find(d => d.id === target.id);
      if (!debtRef || debtRef.remaining <= 0.01) continue;
      const extraPay = Math.min(availableExtra, debtRef.remaining);
      debtRef.remaining -= extraPay;
      totalPaid += extraPay;
      availableExtra -= extraPay;
    }

    // 3) Bu ay kapanan borçları tespit et, minimum taksitlerini havuza ekle
    debts.forEach(d => {
      if (d.remaining <= 0.01 && !payoffOrder.find(p => p.id === d.id)) {
        payoffOrder.push({ id: d.id, name: d.name, monthClosed: month });
        freedUpPayment += d.minPayment;
      }
    });

    monthlySchedule.push({
      month,
      totalRemaining: Number(debts.reduce((sum, d) => sum + Math.max(0, d.remaining), 0).toFixed(2)),
      perDebt: debts.map(d => ({ id: d.id, name: d.name, remaining: Number(Math.max(0, d.remaining).toFixed(2)) }))
    });
  }

  return {
    strategy,
    totalMonths: month,
    totalYears: Number((month / 12).toFixed(1)),
    totalInterestPaid: Number(totalInterestPaid.toFixed(2)),
    totalPaid: Number(totalPaid.toFixed(2)),
    payoffOrder,
    monthlySchedule
  };
}

/** İki stratejiyi aynı borç listesi ve ekstra bütçeyle simüle edip karşılaştırır */
function compareDebtStrategies(debts, extraMonthlyPayment = 0) {
  const avalanche = simulateDebtPayoff(debts, extraMonthlyPayment, 'avalanche');
  const snowball = simulateDebtPayoff(debts, extraMonthlyPayment, 'snowball');

  return {
    avalanche,
    snowball,
    monthsSaved: snowball.totalMonths - avalanche.totalMonths,
    interestSaved: Number((snowball.totalInterestPaid - avalanche.totalInterestPaid).toFixed(2))
  };
}

/** Finans360'ın "Akıllı Finansal Analiz" tarzına uygun Türkçe öneri metni üretir */
function generateStrategyRecommendation(comparison) {
  const { monthsSaved, interestSaved, avalanche, snowball } = comparison;
  const tl = n => n.toLocaleString('tr-TR', { maximumFractionDigits: 0 }) + ' TL';

  if (interestSaved > 50 || monthsSaved > 0) {
    return `Matematiksel olarak en avantajlı seçim <strong>Çığ (Avalanche)</strong> yöntemi: Kartopu'na kıyasla `
      + `<strong>${tl(Math.max(interestSaved, 0))}</strong> daha az faiz ödersiniz ve <strong>${Math.max(monthsSaved, 0)} ay</strong> daha erken `
      + `borçsuz kalırsınız (Çığ: ${avalanche.totalYears} yıl, Kartopu: ${snowball.totalYears} yıl). Ancak Kartopu yöntemi, küçük borçları hızlıca kapatarak `
      + `motivasyon sağladığı için psikolojik olarak daha sürdürülebilir bulunabilir.`;
  }
  return `Bu borç profilinizde iki yöntem arasında belirgin bir fark yok (~${tl(Math.abs(interestSaved))}). `
    + `Motivasyonunuzu daha çok küçük zaferler mi besliyor, yoksa toplam maliyeti mi önemsiyorsunuz — tercihinizi buna göre yapabilirsiniz.`;
}

/** Chart.js line/bar chart için iki stratejinin "toplam kalan borç" eğrisini dataset formatına çevirir */
function buildComparisonChartData(comparison) {
  const maxMonths = Math.max(comparison.avalanche.totalMonths, comparison.snowball.totalMonths);
  const labels = Array.from({ length: maxMonths }, (_, i) => `Ay ${i + 1}`);

  const seriesFor = (result) => labels.map((_, i) => {
    const snap = result.monthlySchedule[i];
    return snap ? fromBaseCurrency(snap.totalRemaining, STATE.currency) : 0;
  });

  return {
    labels,
    datasets: [
      { label: 'Çığ (Avalanche)', data: seriesFor(comparison.avalanche), borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.05)', tension: 0.2, fill: true, pointRadius: maxMonths > 36 ? 0 : 2 },
      { label: 'Kartopu (Snowball)', data: seriesFor(comparison.snowball), borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.05)', tension: 0.2, fill: true, pointRadius: maxMonths > 36 ? 0 : 2 }
    ]
  };
}

function runDebtStrategyAnalysis() {
    // 1) Bilgileri oku ve ekrana yansıt
    let totalMinPayment = 0;
    STATE.debts.forEach(d => totalMinPayment += d.monthlyPayment);
    const extraPayment = STATE.extraMonthlyPayment;
    const totalPayoffBudget = totalMinPayment + extraPayment;

    const totalMinPaymentEl = document.getElementById("strategy-total-min-payment");
    const availableExtraEl = document.getElementById("strategy-available-extra");
    const totalPayoffBudgetEl = document.getElementById("strategy-total-payoff-budget");

    if (totalMinPaymentEl) totalMinPaymentEl.textContent = formatCurrency(totalMinPayment);
    if (availableExtraEl) availableExtraEl.textContent = formatCurrency(extraPayment);
    if (totalPayoffBudgetEl) totalPayoffBudgetEl.textContent = formatCurrency(totalPayoffBudget);

    const recBox = document.getElementById("strategy-recommendation-text");
    const avalancheMonthsEl = document.getElementById("strategy-avalanche-months");
    const avalancheInterestEl = document.getElementById("strategy-avalanche-interest");
    const snowballMonthsEl = document.getElementById("strategy-snowball-months");
    const snowballInterestEl = document.getElementById("strategy-snowball-interest");
    const avalancheOrderEl = document.getElementById("strategy-avalanche-order");
    const snowballOrderEl = document.getElementById("strategy-snowball-order");

    if (!recBox) return; // DOM henüz hazır değilse çık

    if (STATE.debts.length === 0) {
        avalancheMonthsEl.textContent = "0 Ay";
        avalancheInterestEl.textContent = "Toplam Faiz: 0,00 ₺";
        snowballMonthsEl.textContent = "0 Ay";
        snowballInterestEl.textContent = "Toplam Faiz: 0,00 ₺";
        avalancheOrderEl.innerHTML = '<li class="text-muted">Aktif borç bulunamadı.</li>';
        snowballOrderEl.innerHTML = '<li class="text-muted">Aktif borç bulunamadı.</li>';
        recBox.innerHTML = "Karşılaştırma analizini görmek için lütfen bütçe ve borç bilgilerinizi güncelleyin.";
        
        if (charts.strategyComparison) {
            charts.strategyComparison.destroy();
            charts.strategyComparison = null;
        }
        return;
    }

    // 2) Borçları formatla (bugünkü kalan bakiye ve faiz oranı)
    const today = new Date();
    const activeAndFutureDebts = STATE.debts.filter(d => getDebtRemainingPrincipal(d, today) > 0.01);
    
    const simulatorDebts = activeAndFutureDebts.map(d => ({
        id: d.id,
        name: d.name,
        balance: getDebtRemainingPrincipal(d, today),
        annualRate: (d.interest * 12) / 100, // Aylık oranı yıllık ondalığa çevir (örn: 3.75% * 12 / 100 = 0.45)
        minPayment: d.monthlyPayment
    }));

    // 3) Karşılaştır ve simüle et
    const comparison = compareDebtStrategies(simulatorDebts, extraPayment);

    // 4) UI Güncelle
    avalancheMonthsEl.textContent = `${comparison.avalanche.totalMonths} Ay (${comparison.avalanche.totalYears} Yıl)`;
    avalancheInterestEl.textContent = `Toplam Faiz: ${formatCurrency(comparison.avalanche.totalInterestPaid)}`;

    snowballMonthsEl.textContent = `${comparison.snowball.totalMonths} Ay (${comparison.snowball.totalYears} Yıl)`;
    snowballInterestEl.textContent = `Toplam Faiz: ${formatCurrency(comparison.snowball.totalInterestPaid)}`;

    recBox.innerHTML = generateStrategyRecommendation(comparison);

    // Kapanış sıraları listesi
    avalancheOrderEl.innerHTML = "";
    comparison.avalanche.payoffOrder.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${escapeHtml(item.name)}</strong> <span class="badge" style="background: rgba(34, 211, 238, 0.1); color: #22d3ee; border-color: rgba(34, 211, 238, 0.2);">${item.monthClosed}. Ay</span>`;
        avalancheOrderEl.appendChild(li);
    });

    snowballOrderEl.innerHTML = "";
    comparison.snowball.payoffOrder.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${escapeHtml(item.name)}</strong> <span class="badge" style="background: rgba(249, 115, 22, 0.1); color: #f97316; border-color: rgba(249, 115, 22, 0.2);">${item.monthClosed}. Ay</span>`;
        snowballOrderEl.appendChild(li);
    });

    // 5) Çizgi Grafik Çiz
    drawStrategyComparisonChart(comparison);
}

function drawStrategyComparisonChart(comparison) {
    const ctx = document.getElementById("chart-strategy-comparison");
    if (!ctx) return;

    if (charts.strategyComparison) {
        charts.strategyComparison.destroy();
    }

    const chartData = buildComparisonChartData(comparison);
    const symbol = getCurrencySymbol(STATE.currency);
    const locale = getCurrencyLocale(STATE.currency);

    charts.strategyComparison = new Chart(ctx, {
        type: 'line',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#9ca3af',
                        font: { family: 'Plus Jakarta Sans', size: 11 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.raw.toLocaleString(locale)} ${symbol}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.04)" },
                    ticks: {
                        color: "#9ca3af",
                        font: { family: 'Plus Jakarta Sans', size: 10 },
                        callback: function(value) {
                            return value.toLocaleString(locale) + ' ' + symbol;
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: "#9ca3af",
                        font: { family: 'Plus Jakarta Sans', size: 10 },
                        maxTicksLimit: 12
                    }
                }
            }
        }
    });
}

// ==========================================================================
// 12. VERİLERİ SIFIRLAMA (RESET) İŞLEVİ
// ==========================================================================
function initResetDataButton() {
    const resetBtn = document.getElementById("btn-reset-data");
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            if (confirm("Tüm bütçe ve borç verileriniz kalıcı olarak silinecektir. Devam etmek istiyor musunuz?")) {
                try {
                    // Sunucudaki verileri sıfırla
                    await apiRequest("/state/reset", "POST");
                    
                    // Tarayıcı hafızasını temizle
                    localStorage.removeItem("f360_extra_payment");
                    localStorage.removeItem("f360_currency");
                    
                    // Durumu (STATE) sıfırla
                    STATE.budget = {
                        income: 0,
                        rent: 0,
                        groceries: 0,
                        transport: 0,
                        bills: 0,
                        education: 0,
                        health: 0,
                        social: 0,
                        others: 0
                    };
                    STATE.debts = [];
                    STATE.editingDebtId = null;
                    STATE.extraMonthlyPayment = 0;
                    STATE.currency = 'TRY';
                    STATE.limits = {
                        groceries: 0,
                        transport: 0,
                        bills: 0,
                        social: 0
                    };
                    STATE.goals = [];
                    STATE.householdMembers = [{ id: 'me', name: 'Ben', role: 'Ben' }];
                    STATE.householdExpenses = [];
                    STATE.history = [];
                    
                    // Bütçe form alanlarını temizle
                    const budgetInputs = [
                        "input-monthly-income", "input-rent", "input-groceries",
                        "input-transport", "input-bills", "input-education",
                        "input-health", "input-social", "input-others"
                    ];
                    budgetInputs.forEach(id => {
                        const input = document.getElementById(id);
                        if (input) input.value = "";
                    });
                    
                    // Limit alanlarını temizle
                    const limitInputs = [
                        "input-limit-groceries", "input-limit-transport", "input-limit-bills", "input-limit-social"
                    ];
                    limitInputs.forEach(id => {
                        const input = document.getElementById(id);
                        if (input) input.value = "";
                    });

                    // Ekstra ödeme alanını temizle
                    const extraInput = document.getElementById("input-strategy-extra-payment");
                    if (extraInput) extraInput.value = "";
                    
                    // Borç formunu temizle ve iptal et
                    const debtForm = document.getElementById("debt-form");
                    if (debtForm) {
                        debtForm.reset();
                        const inputId = document.getElementById("input-debt-id");
                        if (inputId) inputId.value = "";
                        const saveBtn = document.getElementById("btn-save-debt");
                        if (saveBtn) saveBtn.textContent = "Krediyi Kaydet";
                        const resetBtnDebt = document.getElementById("btn-reset-debt");
                        if (resetBtnDebt) resetBtnDebt.style.display = "none";
                    }
                    
                    // Hedef formunu temizle
                    const goalForm = document.getElementById("goal-form");
                    if (goalForm) goalForm.reset();
                    const goalFormWrapper = document.getElementById("goal-form-wrapper");
                    if (goalFormWrapper) goalFormWrapper.style.display = "none";

                    // Hane formlarını temizle
                    const memberForm = document.getElementById("member-form");
                    if (memberForm) memberForm.reset();
                    const memberFormWrapper = document.getElementById("member-form-wrapper");
                    if (memberFormWrapper) memberFormWrapper.style.display = "none";
                    const hExpenseForm = document.getElementById("household-expense-form");
                    if (hExpenseForm) hExpenseForm.reset();

                    // Para seçicisini sıfırla
                    const currencySelect = document.getElementById("currency-select");
                    if (currencySelect) currencySelect.value = "TRY";

                    // Döviz sembollerini sıfırla
                    const symbols = document.querySelectorAll(".currency-symbol");
                    symbols.forEach(s => s.textContent = "₺");

                    // Başlangıç tarihi varsayılanını bugüne ayarla
                    const today = new Date();
                    const startDateInput = document.getElementById("input-debt-start-date");
                    if (startDateInput) startDateInput.value = getLocalYearMonth(today);
                    
                    // Mock geçmiş verisini tekrar oluştur
                    await generateMockHistoryIfNeeded();

                    // Tabloyu ve tüm hesaplamaları yenile
                    renderDebtsTable();
                    renderGoalsTable();
                    renderHousehold();
                    calculateAll();
                    
                    // Genel Durum sayfasına yönlendir
                    const navDashboard = document.getElementById("nav-dashboard");
                    if (navDashboard) navDashboard.click();
                } catch (err) {
                    console.error("Sıfırlama hatası:", err);
                    alert("Veriler sıfırlanırken sunucu tarafında bir hata oluştu.");
                }
            }
        });
    }
}

// ==========================================================================
// 13. DÖVİZ SEÇİCİ VE KUR HESAPLAMA OLAY DİNLEYİCİSİ
// ==========================================================================
function initCurrencySelector() {
    const select = document.getElementById("currency-select");
    if (!select) return;
    
    let previousCurrency = STATE.currency;
    
    select.addEventListener("change", () => {
        const newCurrency = select.value;
        previousCurrency = STATE.currency;
        STATE.currency = newCurrency;
        localStorage.setItem("f360_currency", newCurrency);
        
        // Üst bar ve formlardaki döviz sembollerini güncelle
        const symbols = document.querySelectorAll(".currency-symbol");
        symbols.forEach(s => s.textContent = getCurrencySymbol(newCurrency));
        
        // Bütçe form alanlarının görüntülenen değerlerini yeni para birimine göre güncelle
        const budgetInputs = {
            "input-monthly-income": STATE.budget.income,
            "input-rent": STATE.budget.rent,
            "input-groceries": STATE.budget.groceries,
            "input-transport": STATE.budget.transport,
            "input-bills": STATE.budget.bills,
            "input-education": STATE.budget.education,
            "input-health": STATE.budget.health,
            "input-social": STATE.budget.social,
            "input-others": STATE.budget.others
        };
        
        for (const [id, baseVal] of Object.entries(budgetInputs)) {
            const el = document.getElementById(id);
            if (el) {
                el.value = baseVal ? fromBaseCurrency(baseVal, newCurrency).toFixed(0) : "";
            }
        }
        
        // Ekstra ödeme input alanını güncelle
        const extraInput = document.getElementById("input-strategy-extra-payment");
        if (extraInput) {
            extraInput.value = STATE.extraMonthlyPayment ? fromBaseCurrency(STATE.extraMonthlyPayment, newCurrency).toFixed(0) : "";
        }
        
        // Kategori limit input alanlarını güncelle
        const limitInputs = {
            "input-limit-groceries": STATE.limits.groceries,
            "input-limit-transport": STATE.limits.transport,
            "input-limit-bills": STATE.limits.bills,
            "input-limit-social": STATE.limits.social
        };
        for (const [id, baseVal] of Object.entries(limitInputs)) {
            const el = document.getElementById(id);
            if (el) {
                el.value = baseVal ? fromBaseCurrency(baseVal, newCurrency).toFixed(0) : "";
            }
        }
        
        // Diğer sekmelerde şu an yazılı olan/görüntülenen tutarları da anlık çevir
        const otherInputs = [
            "input-cc-balance", "input-cc-fixed-pay", "input-goal-amount", "input-h-expense-amount"
        ];
        otherInputs.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value) {
                const currentVal = parseFloat(el.value);
                if (!isNaN(currentVal)) {
                    el.value = fromBaseCurrency(toBaseCurrency(currentVal, previousCurrency), newCurrency).toFixed(0);
                }
            }
        });
        
        // Tabloları yenile (içlerindeki formatCurrency çağrıları otomatik yeni kura göre biçimlendirecektir)
        renderDebtsTable();
        renderGoalsTable();
        renderHousehold();
        
        // Tüm hesaplamaları ve grafikleri yenile
        calculateAll();
        
        // CC Trap simülasyonunu da kur değişince tetikle
        runCcTrapSimulation();
    });
}

// ==========================================================================
// 14. KATEGORİ LİMİTİ OLAY DİNLEYİCİSİ
// ==========================================================================
function initLimitEventListeners() {
    const limitInputs = [
        "input-limit-groceries", "input-limit-transport", "input-limit-bills", "input-limit-social"
    ];
    limitInputs.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        const category = id.replace("input-limit-", "");
        input.addEventListener("input", () => {
            let val = parseFloat(input.value);
            if (isNaN(val) || val < 0) val = 0;
            // Girilen tutarı base para birimine (TRY) çevirip kaydet
            STATE.limits[category] = toBaseCurrency(val, STATE.currency);
            saveLimitsToLocalStorage();
            calculateAll();
        });
    });
}

// ==========================================================================
// 15. HEDEF BAZLI TASARRUF PLANLAYICI
// ==========================================================================
function initGoalEventListeners() {
    const addGoalTrigger = document.getElementById("btn-add-goal-trigger");
    const cancelGoalBtn = document.getElementById("btn-cancel-goal");
    const goalFormWrapper = document.getElementById("goal-form-wrapper");
    const goalForm = document.getElementById("goal-form");
    
    if (addGoalTrigger && goalFormWrapper) {
        addGoalTrigger.addEventListener("click", () => {
            goalFormWrapper.style.display = goalFormWrapper.style.display === "none" ? "block" : "none";
        });
    }
    
    if (cancelGoalBtn && goalFormWrapper) {
        cancelGoalBtn.addEventListener("click", () => {
            goalFormWrapper.style.display = "none";
            if (goalForm) goalForm.reset();
        });
    }
    
    if (goalForm) {
        goalForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const name = document.getElementById("input-goal-name").value.trim();
            const amountVal = parseFloat(document.getElementById("input-goal-amount").value);
            const date = document.getElementById("input-goal-date").value; // YYYY-MM
            
            if (!name || isNaN(amountVal) || amountVal <= 0 || !date) {
                alert("Lütfen tüm alanları geçerli değerlerle doldurun.");
                return;
            }
            
            const todayStr = getLocalYearMonth(new Date());
            const rem = getElapsedMonths(todayStr, date);
            if (rem < 0) {
                alert("Hedef tarih bugünden veya bu aydan önce olamaz.");
                return;
            }
            
            const amount = toBaseCurrency(amountVal, STATE.currency);
            
            const goal = {
                id: Date.now().toString(),
                name,
                amount, // TRY
                date,
                createdDate: todayStr
            };
            
            STATE.goals.push(goal);
            saveGoalsToLocalStorage(goal);
            
            goalForm.reset();
            if (goalFormWrapper) goalFormWrapper.style.display = "none";
            
            renderGoalsTable();
            calculateAll();
        });
    }
}

function renderGoalsTable() {
    const tbody = document.getElementById("goals-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    if (STATE.goals.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-goals-row">
                <td colspan="7" class="text-center text-muted">Henüz eklenmiş bir tasarruf hedefi bulunmamaktadır.</td>
            </tr>
        `;
        return;
    }
    
    const todayStr = getLocalYearMonth(new Date());
    
    STATE.goals.forEach(goal => {
        const remMonths = getElapsedMonths(todayStr, goal.date);
        const elapsedMonths = getElapsedMonths(goal.createdDate, todayStr);
        const totalMonths = getElapsedMonths(goal.createdDate, goal.date);
        
        let remainingLabel = "";
        let monthlyRequired = 0;
        let progressPercent = 0;
        
        if (remMonths <= 0) {
            remainingLabel = "Bu ay doluyor / Doldu";
            monthlyRequired = goal.amount;
            progressPercent = 100;
        } else {
            remainingLabel = `${remMonths} Ay`;
            monthlyRequired = goal.amount / remMonths;
            
            if (totalMonths > 0) {
                progressPercent = Math.min(100, Math.max(0, (elapsedMonths / totalMonths) * 100));
            } else {
                progressPercent = 100;
            }
        }
        
        const savedSoFar = goal.amount * (progressPercent / 100);
        
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${escapeHtml(goal.name)}</strong></td>
            <td>${formatCurrency(goal.amount)}</td>
            <td>${goal.date}</td>
            <td>${remainingLabel}</td>
            <td class="font-weight-bold text-success">${formatCurrency(monthlyRequired)}</td>
            <td>
                <div class="progress-bar-container" style="height: 6px; margin-bottom: 4px;">
                    <div class="progress-bar-fill fill-success" style="width: ${progressPercent}%"></div>
                </div>
                <span style="font-size: 11px; color: var(--text-secondary);">${progressPercent.toFixed(0)}% (${formatCurrency(savedSoFar)} birikti)</span>
            </td>
            <td>
                <button class="btn-icon btn-icon-danger" onclick="deleteGoal('${goal.id}')" title="Sil">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function deleteGoal(id) {
    if (confirm("Bu tasarruf hedefini silmek istediğinizden emin misiniz?")) {
        STATE.goals = STATE.goals.filter(g => g.id !== id);
        saveGoalsToLocalStorage(null, id);
        renderGoalsTable();
        calculateAll();
    }
}

window.deleteGoal = deleteGoal;

// ==========================================================================
// 16. KREDİ KARTI ASGARİ ÖDEME TUZAĞI SİMÜLASYONU
// ==========================================================================
function initCcTrapEventListeners() {
    const balanceInput = document.getElementById("input-cc-balance");
    const interestInput = document.getElementById("input-cc-interest");
    const minRatioInput = document.getElementById("input-cc-min-ratio");
    const fixedPayInput = document.getElementById("input-cc-fixed-pay");
    
    const ccInputs = [balanceInput, interestInput, minRatioInput, fixedPayInput];
    ccInputs.forEach(input => {
        if (input) {
            input.addEventListener("input", runCcTrapSimulation);
        }
    });
}

function runCcTrapSimulation() {
    const balanceVal = parseFloat(document.getElementById("input-cc-balance").value);
    const interest = parseFloat(document.getElementById("input-cc-interest").value);
    const minRatio = parseFloat(document.getElementById("input-cc-min-ratio").value);
    const fixedPayVal = parseFloat(document.getElementById("input-cc-fixed-pay").value);
    
    const asgariMonthsEl = document.getElementById("cc-trap-asgari-months");
    const asgariInterestEl = document.getElementById("cc-trap-asgari-interest");
    const sabitMonthsEl = document.getElementById("cc-trap-sabit-months");
    const sabitInterestEl = document.getElementById("cc-trap-sabit-interest");
    const resultBox = document.getElementById("cc-trap-result-box");
    
    if (isNaN(balanceVal) || balanceVal <= 0 || isNaN(interest) || interest < 0 || isNaN(minRatio) || minRatio <= 0) {
        if (resultBox) resultBox.innerHTML = "Lütfen hesaplama için kredi kartı dönem borcunu girin.";
        return;
    }
    
    // Girdi değerlerini simülasyon için taban para birimine (TRY) çevir
    const balance = toBaseCurrency(balanceVal, STATE.currency);
    const fixedPay = !isNaN(fixedPayVal) && fixedPayVal > 0 ? toBaseCurrency(fixedPayVal, STATE.currency) : 0;
    
    const monthlyInterestRate = interest / 100;
    
    // Simülasyon 1: Sadece asgari ödenirse
    let remAsgari = balance;
    let totalAsgariInterest = 0;
    let monthsAsgari = 0;
    let infiniteAsgari = false;
    
    while (remAsgari > 10 && monthsAsgari < 600) {
        monthsAsgari++;
        const monthInterest = remAsgari * monthlyInterestRate;
        remAsgari += monthInterest;
        totalAsgariInterest += monthInterest;
        
        let minPay = remAsgari * (minRatio / 100);
        minPay = Math.max(minPay, 100); // 100 TL alt sınır (asgari ödeme tabanı)
        
        const payment = Math.min(minPay, remAsgari);
        remAsgari -= payment;
        
        // Eğer asgari ödeme faizi bile kapatamıyorsa ve borç azalmıyorsa sonsuz döngüdür
        if (payment <= monthInterest && remAsgari > 10) {
            infiniteAsgari = true;
            break;
        }
    }
    
    // Simülasyon 2: Sabit ödeme yapılırsa
    let remSabit = balance;
    let totalSabitInterest = 0;
    let monthsSabit = 0;
    let infiniteSabit = false;
    
    if (fixedPay > 0) {
        while (remSabit > 0.01 && monthsSabit < 600) {
            monthsSabit++;
            const monthInterest = remSabit * monthlyInterestRate;
            remSabit += monthInterest;
            totalSabitInterest += monthInterest;
            
            if (fixedPay <= monthInterest) {
                infiniteSabit = true;
                break;
            }
            
            const payment = Math.min(fixedPay, remSabit);
            remSabit -= payment;
        }
    }
    
    // Sonuçları Ekrana Yazdır
    if (asgariMonthsEl && asgariInterestEl) {
        if (infiniteAsgari || monthsAsgari >= 600) {
            asgariMonthsEl.textContent = "Sonsuz Döngü";
            asgariInterestEl.textContent = "Borç ödenemiyor!";
        } else {
            asgariMonthsEl.textContent = `${monthsAsgari} Ay`;
            asgariInterestEl.textContent = `Toplam Faiz: ${formatCurrency(totalAsgariInterest)}`;
        }
    }
    
    if (sabitMonthsEl && sabitInterestEl) {
        if (fixedPay <= 0) {
            sabitMonthsEl.textContent = "-";
            sabitInterestEl.textContent = "Sabit tutar girilmedi";
        } else if (infiniteSabit || monthsSabit >= 600) {
            sabitMonthsEl.textContent = "Sonsuz Döngü";
            sabitInterestEl.textContent = "Faiz ödemeyi aşıyor!";
        } else {
            sabitMonthsEl.textContent = `${monthsSabit} Ay`;
            sabitInterestEl.textContent = `Toplam Faiz: ${formatCurrency(totalSabitInterest)}`;
        }
    }
    
    // Sonuç Açıklama Metni (Türkçe İmla Kurallarına Uygun)
    if (resultBox) {
        let desc = "";
        if (infiniteAsgari) {
            desc += "<p style='color: var(--color-danger); font-weight: 700;'>⚠️ DİKKAT: Asgari ödeme tutarınız aylık faiz yükünün altında olduğu için borcunuz her ay büyümekte ve sonsuz bir borç sarmalına dönüşmektedir!</p>";
        } else {
            desc += `<p>Sadece asgari ödeme yaparsanız borcunuzun tamamen bitmesi <strong>${monthsAsgari} ay</strong> (${(monthsAsgari/12).toFixed(1)} yıl) sürecek ve bu sürede bankaya toplamda <strong>${formatCurrency(totalAsgariInterest)}</strong> faiz ödeyeceksiniz.</p>`;
        }
        
        if (fixedPay > 0) {
            if (infiniteSabit) {
                desc += `<p style='color: var(--color-danger); margin-top: 10px;'>⚠️ Aylık sabit ödemeniz (${formatCurrency(fixedPay)}) aylık biriken faizden düşük olduğu için bu borç hiçbir zaman bitmez. Sabit ödemeyi en az <strong>${formatCurrency(balance * monthlyInterestRate + 100)}</strong> seviyesine çıkarmalısınız.</p>`;
            } else {
                const monthsSaved = monthsAsgari - monthsSabit;
                const interestSaved = totalAsgariInterest - totalSabitInterest;
                if (monthsSaved > 0) {
                    desc += `<p style='color: var(--color-success); margin-top: 10px;'>✔️ Sabit ödeme planıyla borcunuzu <strong>${monthsSaved} ay</strong> daha erken kapatır ve <strong>${formatCurrency(interestSaved)}</strong> daha az faiz ödersiniz!</p>`;
                } else {
                    desc += `<p style='color: var(--color-success); margin-top: 10px;'>✔️ Aylık sabit ödeme seçeneği borcunuzu kapatıyor.</p>`;
                }
            }
        } else {
            desc += `<p style='margin-top: 10px; font-style: italic; color: var(--text-secondary);'>İpucu: Kredi kartı asgari ödeme tuzağından nasıl kurtulabileceğinizi görmek için "Aylık Sabit Ödeme" kısmına bir tutar yazın.</p>`;
        }
        resultBox.innerHTML = desc;
    }
}

// ==========================================================================
// 17. ENFLASYON PROJEKSİYONU VE İLGİLİ İSTATİSTİKLER
// ==========================================================================
function initInflationEventListeners() {
    const infForm = document.getElementById("inflation-proj-form");
    if (infForm) {
        const inputs = infForm.querySelectorAll("input, select");
        inputs.forEach(i => {
            i.addEventListener("input", drawInflationProjectionChart);
        });
    }
}

function drawInflationProjectionChart() {
    const ctx = document.getElementById("chart-inflation-projection");
    if (!ctx) return;
    
    const annualInflation = parseFloat(document.getElementById("input-annual-inflation").value) || 0;
    const incomeRaise = parseFloat(document.getElementById("input-income-raise").value) || 0;
    const raiseMonth = parseInt(document.getElementById("input-raise-month").value) || 7;
    
    const currentIncome = STATE.budget.income;
    const currentExpenses = STATE.budget.rent + STATE.budget.groceries + 
                            STATE.budget.transport + STATE.budget.bills + 
                            STATE.budget.education + STATE.budget.health + 
                            STATE.budget.social + STATE.budget.others;
                            
    // Aylık bileşik enflasyon erimesi
    const monthlyInflation = Math.pow(1 + annualInflation / 100, 1 / 12) - 1;
    
    const months = Array.from({ length: 12 }, (_, i) => `${i + 1}. Ay`);
    const incomeData = [];
    const expenseData = [];
    const cumulativeSavingsData = [];
    
    let cumulativeSavings = 0;
    
    for (let m = 1; m <= 12; m++) {
        // Gelir zammı raiseMonth ve sonrasında geçerli olur
        const projectedIncome = (m >= raiseMonth) ? currentIncome * (1 + incomeRaise / 100) : currentIncome;
        // Giderler her ay enflasyon oranında bileşik artar
        const projectedExpenses = currentExpenses * Math.pow(1 + monthlyInflation, m);
        
        const monthlySavings = projectedIncome - projectedExpenses;
        cumulativeSavings += monthlySavings;
        
        // Değerleri grafik datasetlerine döviz bazında ekle
        incomeData.push(Math.round(fromBaseCurrency(projectedIncome, STATE.currency)));
        expenseData.push(Math.round(fromBaseCurrency(projectedExpenses, STATE.currency)));
        cumulativeSavingsData.push(Math.round(fromBaseCurrency(cumulativeSavings, STATE.currency)));
    }
    
    const symbol = getCurrencySymbol(STATE.currency);
    const locale = getCurrencyLocale(STATE.currency);
    
    if (charts.inflationProjection) {
        charts.inflationProjection.destroy();
    }
    
    charts.inflationProjection = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months,
            datasets: [
                {
                    label: 'Tahmini Gelir',
                    data: incomeData,
                    borderColor: '#10b981',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.1
                },
                {
                    label: 'Tahmini Gider',
                    data: expenseData,
                    borderColor: '#ef4444',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.1
                },
                {
                    label: 'Kümülatif Birikim',
                    data: cumulativeSavingsData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.05)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#9ca3af',
                        font: { family: 'Plus Jakarta Sans', size: 10 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.raw.toLocaleString(locale)} ${symbol}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.04)" },
                    ticks: {
                        color: "#9ca3af",
                        font: { family: 'Plus Jakarta Sans', size: 9 },
                        callback: function(value) {
                            return value.toLocaleString(locale) + ' ' + symbol;
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: "#9ca3af", font: { family: 'Plus Jakarta Sans', size: 9 } }
                }
            }
        }
    });
    
    // Detay kutusunu güncelle
    const descEl = document.getElementById("inflation-proj-desc");
    if (descEl) {
        const totalCashBuilt = cumulativeSavingsData[11];
        const endExpenses = expenseData[11];
        const endIncome = incomeData[11];
        const stateWord = totalCashBuilt >= 0 ? "artı bakiye" : "bütçe açığı";
        const stateColor = totalCashBuilt >= 0 ? "var(--color-success)" : "var(--color-danger)";
        
        descEl.innerHTML = `12 ayın sonunda tahmini aylık geliriniz: <strong>${endIncome.toLocaleString(locale)}${symbol}</strong>, aylık gideriniz: <strong>${endExpenses.toLocaleString(locale)}${symbol}</strong>.<br>Toplam birikim potansiyeliniz: <strong style="color: ${stateColor};">${totalCashBuilt.toLocaleString(locale)}${symbol}</strong> ${stateWord}.`;
    }
}

// ==========================================================================
// 18. HANE BAZLI PAYLAŞIMLI BÜTÇE
// ==========================================================================
function initHouseholdEventListeners() {
    const addMemberTrigger = document.getElementById("btn-add-member-trigger");
    const cancelMemberBtn = document.getElementById("btn-cancel-member");
    const memberFormWrapper = document.getElementById("member-form-wrapper");
    const memberForm = document.getElementById("member-form");
    
    const expenseForm = document.getElementById("household-expense-form");
    
    if (addMemberTrigger && memberFormWrapper) {
        addMemberTrigger.addEventListener("click", () => {
            memberFormWrapper.style.display = memberFormWrapper.style.display === "none" ? "block" : "none";
        });
    }
    
    if (cancelMemberBtn && memberFormWrapper) {
        cancelMemberBtn.addEventListener("click", () => {
            memberFormWrapper.style.display = "none";
            if (memberForm) memberForm.reset();
        });
    }
    
    if (memberForm) {
        memberForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const name = document.getElementById("input-member-name").value.trim();
            const role = document.getElementById("input-member-role").value;
            
            if (!name || !role) return;
            
            const member = {
                id: Date.now().toString(),
                name,
                role
            };
            
            STATE.householdMembers.push(member);
            saveHouseholdToLocalStorage(member);
            
            memberForm.reset();
            if (memberFormWrapper) memberFormWrapper.style.display = "none";
            
            renderHousehold();
            calculateAll();
        });
    }
    
    if (expenseForm) {
        expenseForm.addEventListener("submit", (e) => {
            e.preventDefault();
            const name = document.getElementById("input-h-expense-name").value.trim();
            const amountVal = parseFloat(document.getElementById("input-h-expense-amount").value);
            const payerId = document.getElementById("input-h-expense-payer").value;
            
            if (!name || isNaN(amountVal) || amountVal <= 0 || !payerId) return;
            
            // Harcama tutarını taban para birimi olan TRY'ye çevirip kaydet
            const amount = toBaseCurrency(amountVal, STATE.currency);
            
            const expense = {
                id: Date.now().toString(),
                name,
                amount, // TRY
                payerId
            };
            
            STATE.householdExpenses.push(expense);
            saveHouseholdToLocalStorage(null, null, expense);
            
            expenseForm.reset();
            
            renderHousehold();
            calculateAll();
        });
    }
}

function renderHousehold() {
    const membersTbody = document.getElementById("members-table-body");
    const expensesTbody = document.getElementById("household-expenses-list-body");
    const payerSelect = document.getElementById("input-h-expense-payer");
    const balanceBox = document.getElementById("household-balance-box");
    
    if (!membersTbody) return;
    
    // 1. Ödeyen üye seçim listesini güncelle
    if (payerSelect) {
        payerSelect.innerHTML = "";
        STATE.householdMembers.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.id;
            opt.textContent = m.name;
            payerSelect.appendChild(opt);
        });
    }
    
    // 2. Üyeleri listele ve harcama toplamlarını bul
    membersTbody.innerHTML = "";
    
    const memberContributions = {};
    STATE.householdMembers.forEach(m => {
        memberContributions[m.id] = 0;
    });
    
    let totalHouseholdExpenses = 0;
    STATE.householdExpenses.forEach(exp => {
        if (memberContributions[exp.payerId] !== undefined) {
            memberContributions[exp.payerId] += exp.amount;
            totalHouseholdExpenses += exp.amount;
        }
    });
    
    if (STATE.householdMembers.length === 0) {
        membersTbody.innerHTML = `
            <tr class="empty-members-row">
                <td colspan="4" class="text-center text-muted">Henüz hane üyesi eklenmedi. (Sadece "Ben" varsayılandır).</td>
            </tr>
        `;
    } else {
        STATE.householdMembers.forEach(m => {
            const paid = memberContributions[m.id] || 0;
            
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td><span class="badge badge-type">${m.role}</span></td>
                <td class="text-success">${formatCurrency(paid)}</td>
                <td>
                    ${m.id === 'me' ? '<span class="text-muted" style="font-size:11px;">Varsayılan</span>' : `
                    <button class="btn-icon btn-icon-danger" onclick="deleteMember('${m.id}')" title="Sil">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                    `}
                </td>
            `;
            membersTbody.appendChild(tr);
        });
    }
    
    // 3. Ortak harcamalar listesini güncelle
    if (expensesTbody) {
        expensesTbody.innerHTML = "";
        if (STATE.householdExpenses.length === 0) {
            expensesTbody.innerHTML = `
                <tr class="empty-h-expenses-row">
                    <td colspan="4" class="text-center text-muted">Ortak harcama bulunmamaktadır.</td>
                </tr>
            `;
        } else {
            STATE.householdExpenses.forEach(exp => {
                const payer = STATE.householdMembers.find(m => m.id === exp.payerId);
                const payerName = payer ? payer.name : "Bilinmeyen";
                
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td><strong>${escapeHtml(exp.name)}</strong></td>
                    <td>${escapeHtml(payerName)}</td>
                    <td class="font-weight-bold">${formatCurrency(exp.amount)}</td>
                    <td>
                        <button class="btn-icon btn-icon-danger" onclick="deleteHouseholdExpense('${exp.id}')" title="Sil">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </td>
                `;
                expensesTbody.appendChild(tr);
            });
        }
    }
    
    // 4. Borç Dengesi Paylaşım Algoritması (Splitwise Benzeri Greedy Settle)
    if (balanceBox) {
        const N = STATE.householdMembers.length;
        if (N <= 1 || STATE.householdExpenses.length === 0) {
            balanceBox.innerHTML = "Hesaplama için lütfen hane üyesi ekleyin ve en az bir ortak harcama kaydedin.";
        } else {
            const share = totalHouseholdExpenses / N;
            
            // Kişilerin durumları (pozitif ise alacaklı, negatif ise borçlu)
            const balances = STATE.householdMembers.map(m => {
                const paid = memberContributions[m.id] || 0;
                return {
                    id: m.id,
                    name: m.name,
                    balance: paid - share
                };
            });
            
            const debtors = balances.filter(b => b.balance < -0.01).sort((a, b) => a.balance - b.balance); // En çok borçlu olandan başla
            const creditors = balances.filter(b => b.balance > 0.01).sort((a, b) => b.balance - a.balance); // En çok alacaklı olandan başla
            
            const transactions = [];
            let dIdx = 0;
            let cIdx = 0;
            
            while (dIdx < debtors.length && cIdx < creditors.length) {
                const debtor = debtors[dIdx];
                const creditor = creditors[cIdx];
                
                const owes = -debtor.balance;
                const owed = creditor.balance;
                
                const tAmount = Math.min(owes, owed);
                
                transactions.push({
                    from: debtor.name,
                    to: creditor.name,
                    amount: tAmount
                });
                
                debtor.balance += tAmount;
                creditor.balance -= tAmount;
                
                if (Math.abs(debtor.balance) < 0.01) {
                    dIdx++;
                }
                if (Math.abs(creditor.balance) < 0.01) {
                    cIdx++;
                }
            }
            
            if (transactions.length === 0) {
                balanceBox.innerHTML = "✔️ Tüm ortak harcamalar dengelidir. Kimsenin borcu bulunmamaktadır.";
            } else {
                let html = "<ul style='padding-left: 20px; display:flex; flex-direction:column; gap:6px;'>";
                transactions.forEach(t => {
                    html += `<li><strong>${escapeHtml(t.from)}</strong>, <strong>${escapeHtml(t.to)}</strong> isimli üyeye <strong>${formatCurrency(t.amount)}</strong> ödemelidir.</li>`;
                });
                html += "</ul>";
                balanceBox.innerHTML = html;
            }
        }
    }
    
    // 5. Paylaşım Grafiğini Çiz
    drawHouseholdDistributionChart(memberContributions);
}

function deleteMember(id) {
    if (confirm("Bu hane üyesini silmek istediğinizden emin misiniz?")) {
        STATE.householdMembers = STATE.householdMembers.filter(m => m.id !== id);
        // Bu üyenin ödediği harcamaları da sil
        STATE.householdExpenses = STATE.householdExpenses.filter(exp => exp.payerId !== id);
        saveHouseholdToLocalStorage(null, id);
        renderHousehold();
        calculateAll();
    }
}

function deleteHouseholdExpense(id) {
    if (confirm("Bu ortak harcama kaydını silmek istediğinizden emin misiniz?")) {
        STATE.householdExpenses = STATE.householdExpenses.filter(exp => exp.id !== id);
        saveHouseholdToLocalStorage(null, null, null, id);
        renderHousehold();
        calculateAll();
    }
}

function drawHouseholdDistributionChart(contributions) {
    const ctx = document.getElementById("chart-household-distribution");
    if (!ctx) return;
    
    const labels = [];
    const data = [];
    const colors = ["#10b981", "#3b82f6", "#a78bfa", "#f59e0b", "#ef4444", "#cbd5e1"];
    const backgroundColors = [];
    
    STATE.householdMembers.forEach((m, idx) => {
        const contrib = contributions[m.id] || 0;
        if (contrib > 0) {
            labels.push(m.name);
            data.push(Math.round(fromBaseCurrency(contrib, STATE.currency)));
            backgroundColors.push(colors[idx % colors.length]);
        }
    });
    
    if (charts.householdDistribution) {
        charts.householdDistribution.destroy();
    }
    
    if (data.length === 0) {
        charts.householdDistribution = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ["Veri Yok"],
                datasets: [{
                    data: [1],
                    backgroundColor: ["rgba(255,255,255,0.05)"],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
        return;
    }
    
    const symbol = getCurrencySymbol(STATE.currency);
    
    charts.householdDistribution = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
                borderWidth: 1,
                borderColor: "#0b0d15"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#9ca3af',
                        font: { size: 11, family: 'Plus Jakarta Sans' },
                        boxWidth: 10
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percent = ((val / total) * 100).toFixed(1);
                            return `${context.label}: ${val.toLocaleString()} ${symbol} (%${percent})`;
                        }
                    }
                }
            },
            cutout: '60%'
        }
    });
}

window.deleteMember = deleteMember;
window.deleteHouseholdExpense = deleteHouseholdExpense;

// ==========================================================================
// 19. GEÇMİŞ TREND RAPORLAMA VE MOCK DATA MOTORU
// ==========================================================================
async function generateMockHistoryIfNeeded() {
    if (STATE.history && STATE.history.length > 0) return;
    
    const today = new Date();
    const history = [];
    
    // Varsayılan gelir ve giderlerden yola çıkarak son 5 ayın mock verilerini doldur
    const defaultIncome = 50000;
    const defaultExpenses = 38000;
    
    const factors = [
        { income: 0.90, expense: 0.92 }, // 5 ay önce
        { income: 0.90, expense: 0.88 }, // 4 ay önce
        { income: 0.95, expense: 0.96 }, // 3 ay önce
        { income: 1.00, expense: 1.05 }, // 2 ay önce
        { income: 1.00, expense: 0.95 }  // 1 ay önce (Mayıs)
    ];
    
    for (let idx = 0; idx < 5; idx++) {
        const d = new Date();
        d.setMonth(today.getMonth() - (5 - idx));
        const monthStr = getLocalYearMonth(d);
        
        const income = defaultIncome * factors[idx].income;
        const expense = defaultExpenses * factors[idx].expense;
        
        history.push({
            month: monthStr,
            income: income,
            expenses: expense,
            savings: income - expense
        });
    }
    
    STATE.history = history;
    await saveHistoryToLocalStorage();
}

function drawHistoryTrendChart() {
    const ctx = document.getElementById("chart-history-trend");
    if (!ctx) return;
    
    const today = new Date();
    const currentMonthStr = getLocalYearMonth(today);
    
    const currentIncome = STATE.budget.income;
    const currentExpenses = STATE.budget.rent + STATE.budget.groceries + 
                           STATE.budget.transport + STATE.budget.bills + 
                           STATE.budget.education + STATE.budget.health + 
                           STATE.budget.social + STATE.budget.others;
                           
    let totalMonthlyDebt = 0;
    STATE.debts.forEach(d => totalMonthlyDebt += getDebtMonthlyPaymentAt(d, today));
    const totalExpenses = currentExpenses + totalMonthlyDebt;
    
    const fullHistory = [...STATE.history];
    
    // Güncel ayı en sona ekle
    const currentSnap = {
        month: currentMonthStr,
        income: currentIncome,
        expenses: totalExpenses,
        savings: currentIncome - totalExpenses
    };
    fullHistory.push(currentSnap);
    
    // Son 6 ayı al
    const last6 = fullHistory.slice(-6);
    
    const labels = last6.map(item => {
        const [y, m] = item.month.split("-").map(Number);
        return `${TURKISH_MONTHS[m - 1]} ${y}`;
    });
    
    const incomeData = last6.map(item => Math.round(fromBaseCurrency(item.income, STATE.currency)));
    const expenseData = last6.map(item => Math.round(fromBaseCurrency(item.expenses, STATE.currency)));
    
    const symbol = getCurrencySymbol(STATE.currency);
    const locale = getCurrencyLocale(STATE.currency);
    
    if (charts.historyTrend) {
        charts.historyTrend.destroy();
    }
    
    charts.historyTrend = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Aylık Gelir',
                    data: incomeData,
                    backgroundColor: 'rgba(16, 185, 129, 0.85)',
                    borderColor: 'var(--color-success)',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: 'Aylık Gider',
                    data: expenseData,
                    backgroundColor: 'rgba(244, 63, 94, 0.85)',
                    borderColor: 'var(--color-danger)',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#9ca3af',
                        font: { family: 'Plus Jakarta Sans', size: 10 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.raw.toLocaleString(locale)} ${symbol}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: "rgba(255, 255, 255, 0.04)" },
                    ticks: {
                        color: "#9ca3af",
                        font: { family: 'Plus Jakarta Sans', size: 9 },
                        callback: function(value) {
                            return value.toLocaleString(locale) + ' ' + symbol;
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: "#9ca3af", font: { family: 'Plus Jakarta Sans', size: 9 } }
                }
            }
        }
    });
    
    // Geçen aya göre değişim rozetlerini güncelle
    updateChangeBadges(last6);
}

function updateChangeBadges(last6) {
    if (last6.length < 2) return;
    const prev = last6[last6.length - 2];
    const curr = last6[last6.length - 1];
    
    const incomePrevEl = document.getElementById("change-income-prev");
    const incomeBadge = document.getElementById("change-income-badge");
    const expensePrevEl = document.getElementById("change-expense-prev");
    const expenseBadge = document.getElementById("change-expense-badge");
    const savingsPrevEl = document.getElementById("change-savings-prev");
    const savingsBadge = document.getElementById("change-savings-badge");
    
    if (incomePrevEl && incomeBadge) {
        incomePrevEl.textContent = `Geçen ay: ${formatCurrency(prev.income)}`;
        const pct = prev.income > 0 ? ((curr.income - prev.income) / prev.income) * 100 : 0;
        incomeBadge.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
        incomeBadge.className = pct > 0 ? "text-success" : pct < 0 ? "text-danger" : "text-muted";
    }
    
    if (expensePrevEl && expenseBadge) {
        expensePrevEl.textContent = `Geçen ay: ${formatCurrency(prev.expenses)}`;
        const pct = prev.expenses > 0 ? ((curr.expenses - prev.expenses) / prev.expenses) * 100 : 0;
        expenseBadge.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
        expenseBadge.className = pct < 0 ? "text-success" : pct > 0 ? "text-danger" : "text-muted";
    }
    
    if (savingsPrevEl && savingsBadge) {
        const prevSavings = prev.income - prev.expenses;
        const currSavings = curr.income - curr.expenses;
        savingsPrevEl.textContent = `Geçen ay: ${formatCurrency(prevSavings)}`;
        
        let pct = 0;
        if (prevSavings > 0) {
            pct = ((currSavings - prevSavings) / prevSavings) * 100;
        } else if (prevSavings === 0 && currSavings > 0) {
            pct = 100;
        }
        
        savingsBadge.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
        savingsBadge.className = currSavings > prevSavings ? "text-success" : currSavings < prevSavings ? "text-danger" : "text-muted";
    }
}

// Grafik Güncelleme Listesine Yeni Grafikleri Ekle
function updateCharts() {
    drawExpensesDistributionChart();
    drawIncomeVsExpenseChart();
    drawSavingsGaugeChart();
    drawDebtAmortizationChart();
    runDebtStrategyAnalysis();
    drawHistoryTrendChart();
    drawInflationProjectionChart();
}
