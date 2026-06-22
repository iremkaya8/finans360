import http.server
import socketserver
import json
import sqlite3
import hashlib
import os
import urllib.parse

PORT = 3000
DB_FILE = "finans360.db"

# Oturum yönetimi (Bellek içi: Token -> user_id)
SESSIONS = {}

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password, salt=None):
    if salt is None:
        salt = os.urandom(16).hex()
    # PBKDF2 kullanarak güvenli hash oluştur
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), 100000)
    return dk.hex(), salt

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Kullanıcılar tablosu
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL
    )
    """)
    
    # Bütçe tablosu
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS budget (
        user_id INTEGER PRIMARY KEY,
        income REAL DEFAULT 0,
        rent REAL DEFAULT 0,
        groceries REAL DEFAULT 0,
        transport REAL DEFAULT 0,
        bills REAL DEFAULT 0,
        education REAL DEFAULT 0,
        health REAL DEFAULT 0,
        social REAL DEFAULT 0,
        others REAL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Borçlar tablosu
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS debts (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        interest REAL NOT NULL,
        maturity INTEGER NOT NULL,
        startDate TEXT NOT NULL,
        monthlyPayment REAL NOT NULL,
        totalRepayment REAL NOT NULL,
        totalInterest REAL NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Limitler tablosu
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS limits (
        user_id INTEGER PRIMARY KEY,
        groceries REAL DEFAULT 0,
        transport REAL DEFAULT 0,
        bills REAL DEFAULT 0,
        social REAL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Tasarruf Hedefleri tablosu
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        createdDate TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Hane Üyeleri tablosu
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS household_members (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Hane Ortak Giderleri tablosu
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS household_expenses (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        payerId TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Bütçe Geçmişi tablosu
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        month TEXT NOT NULL,
        income REAL NOT NULL,
        expenses REAL NOT NULL,
        savings REAL NOT NULL,
        UNIQUE(user_id, month),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)
    
    # Demo kullanıcıyı kontrol et ve tohumla (seed)
    cursor.execute("SELECT id FROM users WHERE email = ?", ("demo@finans360.com",))
    if not cursor.fetchone():
        pw_hash, salt = hash_password("123456")
        cursor.execute("INSERT INTO users (email, password_hash, salt) VALUES (?, ?, ?)", ("demo@finans360.com", pw_hash, salt))
        user_id = cursor.lastrowid
        cursor.execute("INSERT INTO budget (user_id) VALUES (?)", (user_id,))
        cursor.execute("INSERT INTO limits (user_id) VALUES (?)", (user_id,))
        cursor.execute("INSERT INTO household_members (id, user_id, name, role) VALUES (?, ?, ?, ?)", ('me', user_id, 'Ben', 'Ben'))
    
    conn.commit()
    conn.close()

class ApiHandler(http.server.BaseHTTPRequestHandler):
    def end_headers(self):
        # CORS Header'larını ekle
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()
        
    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()
        
    def send_json(self, data, status_code=200):
        response_bytes = json.dumps(data).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)
        
    def get_user_id_from_token(self):
        auth_header = self.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return None
        token = auth_header.split(' ')[1]
        return SESSIONS.get(token)
        
    def read_json_body(self):
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length)
        return json.loads(body.decode('utf-8'))
        
    def do_POST(self):
        # Rota Kontrolleri
        path = self.path
        
        # 1. Kayıt Ol (Auth Register)
        if path == "/api/auth/register":
            try:
                data = self.read_json_body()
                email = data.get("email", "").strip()
                password = data.get("password", "")
                
                if not email or not password:
                    return self.send_json({"error": "E-posta ve şifre gereklidir."}, 400)
                    
                conn = get_db_connection()
                cursor = conn.cursor()
                
                # Kullanıcı var mı kontrol et
                cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
                if cursor.fetchone():
                    conn.close()
                    return self.send_json({"error": "Bu e-posta adresiyle kayıtlı bir kullanıcı zaten var."}, 400)
                    
                # Şifreyi tuzlayarak hash'le
                pw_hash, salt = hash_password(password)
                
                # Kullanıcıyı ekle
                cursor.execute("INSERT INTO users (email, password_hash, salt) VALUES (?, ?, ?)", (email, pw_hash, salt))
                user_id = cursor.lastrowid
                
                # Varsayılan bütçe, limit ve varsayılan hane üyesi ("Ben") oluştur
                cursor.execute("INSERT INTO budget (user_id) VALUES (?)", (user_id,))
                cursor.execute("INSERT INTO limits (user_id) VALUES (?)", (user_id,))
                cursor.execute("INSERT INTO household_members (id, user_id, name, role) VALUES (?, ?, ?, ?)", ('me', user_id, 'Ben', 'Ben'))
                
                conn.commit()
                conn.close()
                
                return self.send_json({"success": True, "message": "Kayıt başarıyla oluşturuldu."}, 201)
            except Exception as e:
                return self.send_json({"error": str(e)}, 500)
                
        # 2. Giriş Yap (Auth Login)
        elif path == "/api/auth/login":
            try:
                data = self.read_json_body()
                email = data.get("email", "").strip()
                password = data.get("password", "")
                
                if not email or not password:
                    return self.send_json({"error": "E-posta ve şifre alanları boş bırakılamaz."}, 400)
                    
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute("SELECT id, password_hash, salt FROM users WHERE email = ?", (email,))
                user = cursor.fetchone()
                conn.close()
                
                if not user:
                    return self.send_json({"error": "Geçersiz e-posta veya şifre."}, 401)
                    
                # Şifre doğrulaması
                pw_hash, _ = hash_password(password, user['salt'])
                if pw_hash != user['password_hash']:
                    return self.send_json({"error": "Geçersiz e-posta veya şifre."}, 401)
                    
                # Oturum token'ı üret
                token = os.urandom(16).hex()
                SESSIONS[token] = user['id']
                
                return self.send_json({"success": True, "token": token, "email": email})
            except Exception as e:
                return self.send_json({"error": str(e)}, 500)
                
        # 3. Çıkış Yap (Auth Logout)
        elif path == "/api/auth/logout":
            auth_header = self.headers.get('Authorization')
            if auth_header and auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
                if token in SESSIONS:
                    del SESSIONS[token]
            return self.send_json({"success": True})
            
        # --- Yetkilendirme Gerektiren Diğer Rotalar ---
        user_id = self.get_user_id_from_token()
        if not user_id:
            return self.send_json({"error": "Oturum süresi dolmuş veya geçersiz yetkilendirme."}, 401)
            
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # 4. Bütçe Güncelle
            if path == "/api/budget":
                data = self.read_json_body()
                cursor.execute("""
                INSERT INTO budget (user_id, income, rent, groceries, transport, bills, education, health, social, others)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    income=excluded.income, rent=excluded.rent, groceries=excluded.groceries,
                    transport=excluded.transport, bills=excluded.bills, education=excluded.education,
                    health=excluded.health, social=excluded.social, others=excluded.others
                """, (
                    user_id, data.get("income", 0), data.get("rent", 0), data.get("groceries", 0),
                    data.get("transport", 0), data.get("bills", 0), data.get("education", 0),
                    data.get("health", 0), data.get("social", 0), data.get("others", 0)
                ))
                conn.commit()
                self.send_json({"success": True})
                
            # 5. Limit Güncelle
            elif path == "/api/limits":
                data = self.read_json_body()
                cursor.execute("""
                INSERT INTO limits (user_id, groceries, transport, bills, social)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    groceries=excluded.groceries, transport=excluded.transport,
                    bills=excluded.bills, social=excluded.social
                """, (
                    user_id, data.get("groceries", 0), data.get("transport", 0),
                    data.get("bills", 0), data.get("social", 0)
                ))
                conn.commit()
                self.send_json({"success": True})
                
            # 6. Borç Ekle / Güncelle
            elif path == "/api/debts":
                data = self.read_json_body()
                cursor.execute("""
                INSERT INTO debts (id, user_id, name, type, amount, interest, maturity, startDate, monthlyPayment, totalRepayment, totalInterest)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, type=excluded.type, amount=excluded.amount, interest=excluded.interest,
                    maturity=excluded.maturity, startDate=excluded.startDate, monthlyPayment=excluded.monthlyPayment,
                    totalRepayment=excluded.totalRepayment, totalInterest=excluded.totalInterest
                """, (
                    data.get("id"), user_id, data.get("name"), data.get("type"),
                    data.get("amount"), data.get("interest"), data.get("maturity"),
                    data.get("startDate"), data.get("monthlyPayment"),
                    data.get("totalRepayment"), data.get("totalInterest")
                ))
                conn.commit()
                self.send_json({"success": True})
                
            # 7. Tasarruf Hedefi Ekle
            elif path == "/api/goals":
                data = self.read_json_body()
                cursor.execute("""
                INSERT INTO goals (id, user_id, name, amount, date, createdDate)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, amount=excluded.amount, date=excluded.date
                """, (
                    data.get("id"), user_id, data.get("name"), data.get("amount"),
                    data.get("date"), data.get("createdDate")
                ))
                conn.commit()
                self.send_json({"success": True})
                
            # 8. Hane Üyesi Ekle
            elif path == "/api/household/members":
                data = self.read_json_body()
                cursor.execute("""
                INSERT INTO household_members (id, user_id, name, role)
                VALUES (?, ?, ?, ?)
                """, (data.get("id"), user_id, data.get("name"), data.get("role")))
                conn.commit()
                self.send_json({"success": True})
                
            # 9. Hane Ortak Gideri Ekle
            elif path == "/api/household/expenses":
                data = self.read_json_body()
                cursor.execute("""
                INSERT INTO household_expenses (id, user_id, name, amount, payerId)
                VALUES (?, ?, ?, ?, ?)
                """, (data.get("id"), user_id, data.get("name"), data.get("amount"), data.get("payerId")))
                conn.commit()
                self.send_json({"success": True})
                
            # 10. Geçmiş Bütçe Ekle
            elif path == "/api/history":
                data = self.read_json_body()
                
                # Eğer dizi olarak gönderildiyse (toptan mock yükleme veya sıfırlama)
                if isinstance(data, list):
                    cursor.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
                    for item in data:
                        cursor.execute("""
                        INSERT INTO history (user_id, month, income, expenses, savings)
                        VALUES (?, ?, ?, ?, ?)
                        """, (user_id, item.get("month"), item.get("income"), item.get("expenses"), item.get("savings")))
                else:
                    cursor.execute("""
                    INSERT INTO history (user_id, month, income, expenses, savings)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, month) DO UPDATE SET
                        income=excluded.income, expenses=excluded.expenses, savings=excluded.savings
                    """, (user_id, data.get("month"), data.get("income"), data.get("expenses"), data.get("savings")))
                
                conn.commit()
                self.send_json({"success": True})
                
            # 10B. Tüm Verileri Sıfırla (State Reset)
            elif path == "/api/state/reset":
                cursor.execute("DELETE FROM debts WHERE user_id = ?", (user_id,))
                cursor.execute("DELETE FROM goals WHERE user_id = ?", (user_id,))
                cursor.execute("DELETE FROM household_members WHERE user_id = ? AND id != 'me'", (user_id,))
                cursor.execute("DELETE FROM household_expenses WHERE user_id = ?", (user_id,))
                cursor.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
                cursor.execute("""
                UPDATE budget SET
                    income=0, rent=0, groceries=0, transport=0, bills=0,
                    education=0, health=0, social=0, others=0
                WHERE user_id = ?
                """, (user_id,))
                cursor.execute("""
                UPDATE limits SET
                    groceries=0, transport=0, bills=0, social=0
                WHERE user_id = ?
                """, (user_id,))
                conn.commit()
                self.send_json({"success": True})
                
            else:
                self.send_json({"error": "Rota bulunamadı."}, 404)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)
        finally:
            conn.close()
            
    def do_GET(self):
        user_id = self.get_user_id_from_token()
        if not user_id:
            return self.send_json({"error": "Geçersiz yetkilendirme veya aktif oturum bulunamadı."}, 401)
            
        path = self.path
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # 11. Tüm Kullanıcı Durumunu Çek (GET /api/state)
            if path == "/api/state":
                # Bütçe verisi
                cursor.execute("SELECT income, rent, groceries, transport, bills, education, health, social, others FROM budget WHERE user_id = ?", (user_id,))
                budget_row = cursor.fetchone()
                budget_dict = dict(budget_row) if budget_row else {
                    "income": 0, "rent": 0, "groceries": 0, "transport": 0, "bills": 0,
                    "education": 0, "health": 0, "social": 0, "others": 0
                }
                
                # Limit verisi
                cursor.execute("SELECT groceries, transport, bills, social FROM limits WHERE user_id = ?", (user_id,))
                limits_row = cursor.fetchone()
                limits_dict = dict(limits_row) if limits_row else {
                    "groceries": 0, "transport": 0, "bills": 0, "social": 0
                }
                
                # Borçlar
                cursor.execute("SELECT id, name, type, amount, interest, maturity, startDate, monthlyPayment, totalRepayment, totalInterest FROM debts WHERE user_id = ?", (user_id,))
                debts_list = [dict(row) for row in cursor.fetchall()]
                
                # Hedefler
                cursor.execute("SELECT id, name, amount, date, createdDate FROM goals WHERE user_id = ?", (user_id,))
                goals_list = [dict(row) for row in cursor.fetchall()]
                
                # Hane Üyeleri
                cursor.execute("SELECT id, name, role FROM household_members WHERE user_id = ?", (user_id,))
                members_list = [dict(row) for row in cursor.fetchall()]
                # Eğer hane üyesi yoksa varsayılan olarak "Ben" ekle
                if not members_list:
                    cursor.execute("INSERT INTO household_members (id, user_id, name, role) VALUES (?, ?, ?, ?)", ('me', user_id, 'Ben', 'Ben'))
                    conn.commit()
                    members_list = [{"id": "me", "name": "Ben", "role": "Ben"}]
                
                # Hane Ortak Giderleri
                cursor.execute("SELECT id, name, amount, payerId FROM household_expenses WHERE user_id = ?", (user_id,))
                expenses_list = [dict(row) for row in cursor.fetchall()]
                
                # Geçmiş Trendler
                cursor.execute("SELECT month, income, expenses, savings FROM history WHERE user_id = ? ORDER BY month ASC", (user_id,))
                history_list = [dict(row) for row in cursor.fetchall()]
                
                state_data = {
                    "budget": budget_dict,
                    "debts": debts_list,
                    "limits": limits_dict,
                    "goals": goals_list,
                    "householdMembers": members_list,
                    "householdExpenses": expenses_list,
                    "history": history_list
                }
                self.send_json(state_data)
            else:
                self.send_json({"error": "Rota bulunamadı."}, 404)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)
        finally:
            conn.close()
            
    def do_DELETE(self):
        user_id = self.get_user_id_from_token()
        if not user_id:
            return self.send_json({"error": "Yetkisiz işlem."}, 401)
            
        path = self.path
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # 12. Borç Sil
            if path.startswith("/api/debts/"):
                debt_id = path.replace("/api/debts/", "").strip()
                cursor.execute("DELETE FROM debts WHERE id = ? AND user_id = ?", (debt_id, user_id))
                conn.commit()
                self.send_json({"success": True})
                
            # 13. Tasarruf Hedefi Sil
            elif path.startswith("/api/goals/"):
                goal_id = path.replace("/api/goals/", "").strip()
                cursor.execute("DELETE FROM goals WHERE id = ? AND user_id = ?", (goal_id, user_id))
                conn.commit()
                self.send_json({"success": True})
                
            # 14. Hane Üyesi Sil
            elif path.startswith("/api/household/members/"):
                member_id = path.replace("/api/household/members/", "").strip()
                if member_id == 'me':
                    return self.send_json({"error": "Varsayılan üye 'Ben' silinemez."}, 400)
                # Üyeyi sil
                cursor.execute("DELETE FROM household_members WHERE id = ? AND user_id = ?", (member_id, user_id))
                # Bu üyenin ödediği tüm giderleri de temizle
                cursor.execute("DELETE FROM household_expenses WHERE payerId = ? AND user_id = ?", (member_id, user_id))
                conn.commit()
                self.send_json({"success": True})
                
            # 15. Hane Ortak Gideri Sil
            elif path.startswith("/api/household/expenses/"):
                expense_id = path.replace("/api/household/expenses/", "").strip()
                cursor.execute("DELETE FROM household_expenses WHERE id = ? AND user_id = ?", (expense_id, user_id))
                conn.commit()
                self.send_json({"success": True})
                
            else:
                self.send_json({"error": "Rota bulunamadı."}, 404)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)
        finally:
            conn.close()

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    pass

if __name__ == "__main__":
    init_db()
    server_address = ('', PORT)
    httpd = ThreadingHTTPServer(server_address, ApiHandler)
    print(f"Finans360 SQLite API Sunucusu port {PORT} üzerinde çalışıyor...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nSunucu kapatılıyor...")
        httpd.server_close()
