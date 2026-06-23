/* ============================================================
   GreenHouse IoT — Main Application Logic
   Real-time sensor reading from ESP32 via HTTP API
   ============================================================ */

(function () {
    'use strict';

    // ==================== ZONE CONFIGURATION ====================
    const ZONE_CONFIG = [
        {
            id: 0,
            name: 'Zona Sayuran',
            emoji: '🥬',
            desc: 'Selada, Tomat, Timun',
            threshold: 40,
            waterDuration: 30,
            autoMode: true,
        },
        {
            id: 1,
            name: 'Zona Buah',
            emoji: '🍓',
            desc: 'Stroberi, Melon, Semangka',
            threshold: 45,
            waterDuration: 45,
            autoMode: true,
        },
        {
            id: 2,
            name: 'Zona Tanaman Hias',
            emoji: '🌺',
            desc: 'Anggrek, Mawar, Lili',
            threshold: 35,
            waterDuration: 20,
            autoMode: true,
        },
    ];

    // ==================== APPLICATION CLASS ====================
    class GreenHouseApp {
        constructor() {
            // Base zone data (sensor values will be filled from ESP32)
            this.zones = ZONE_CONFIG.map((cfg) => ({
                ...cfg,
                moisture: 0,
                temperature: 0,
                humidity: 0,
                light: 0,
                pumpActive: false,
                pumpTimer: null,
                pumpCountdown: 0,
                lastWatered: null,
                moistureHistory: [],
                tempHistory: [],
                humidityHistory: [],
            }));

            this.activityLog = [];
            this.notifications = [];
            this.schedules = [];
            this.chartRange = '1h';
            this.chartData = { moisture: [], temp: [], humidity: [], labels: [] };
            this.isDark = true;
            this.masterAuto = true;
            this.sensorInterval = 3000; // ms, can be changed in settings
            this.tick = 0;

            // ESP32 connection
            this.esp32BaseUrl = 'http://192.168.1.100';
            this.esp32Connected = false;

            this.init();
        }

        // ==================== INITIALIZATION ====================
        init() {
            this.loadState();
            this.loadESP32IP();
            this.setupNavigation();
            this.setupTheme();
            this.setupSidebar();
            this.setupNotificationPanel();
            this.setupZoneControls();
            this.setupAutomationControls();
            this.setupChartControls();
            this.setupSchedule();
            this.setupSettings();
            this.startClock();
            this.startSensorPolling();
            this.seedChartHistory();
            this.addActivity('system', '🟢 Sistem GreenHouse IoT dimulai (terhubung ke ESP32)');
            this.showToast('success', 'Sistem GreenHouse IoT aktif — menghubungkan ke ESP32...');
            // Initial fetch
            this.updateSensors();
        }

        // ==================== NAVIGATION ====================
        setupNavigation() {
            // ... (sama seperti sebelumnya, tidak diubah)
            const navLinks = document.querySelectorAll('.nav-link');
            const titles = {
                dashboard: ['Dashboard', 'Monitoring real-time greenhouse Anda'],
                schedule: ['Jadwal Penyiraman', 'Atur jadwal penyiraman otomatis'],
                settings: ['Pengaturan', 'Konfigurasi sistem greenhouse'],
            };

            navLinks.forEach((link) => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const section = link.dataset.section;

                    navLinks.forEach((l) => l.classList.remove('active'));
                    link.classList.add('active');

                    document.querySelectorAll('.content-section').forEach((s) => s.classList.remove('active'));
                    const target = document.getElementById(`section-${section}`);
                    if (target) target.classList.add('active');

                    const [title, subtitle] = titles[section] || ['Dashboard', ''];
                    document.getElementById('pageTitle').textContent = title;
                    document.getElementById('pageSubtitle').textContent = subtitle;

                    this.closeSidebar();

                    if (section === 'dashboard') {
                        requestAnimationFrame(() => this.drawChart());
                    }
                });
            });
        }

        // ==================== SIDEBAR ====================
        setupSidebar() {
            // ... sama
            const toggle = document.getElementById('menuToggle');
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');

            toggle.addEventListener('click', () => {
                sidebar.classList.toggle('open');
                overlay.classList.toggle('visible');
            });

            overlay.addEventListener('click', () => this.closeSidebar());
        }

        closeSidebar() {
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('visible');
        }

        // ==================== THEME ====================
        setupTheme() {
            // ... sama
            const btn = document.getElementById('themeToggle');
            const icon = document.getElementById('themeIcon');

            const saved = localStorage.getItem('gh_theme');
            if (saved) {
                this.isDark = saved === 'dark';
                document.documentElement.dataset.theme = saved;
                icon.textContent = this.isDark ? '🌙' : '☀️';
            }

            btn.addEventListener('click', () => {
                this.isDark = !this.isDark;
                document.documentElement.dataset.theme = this.isDark ? 'dark' : 'light';
                icon.textContent = this.isDark ? '🌙' : '☀️';
                localStorage.setItem('gh_theme', this.isDark ? 'dark' : 'light');

                this.zones.forEach((z) => {
                    this.drawGauge('moisture', z.id, z.moisture, 100);
                    this.drawGauge('temp', z.id, z.temperature, 50);
                });
                this.drawChart();
            });
        }

        // ==================== CLOCK ====================
        startClock() {
            const update = () => {
                const now = new Date();
                const h = String(now.getHours()).padStart(2, '0');
                const m = String(now.getMinutes()).padStart(2, '0');
                const s = String(now.getSeconds()).padStart(2, '0');
                document.getElementById('clockText').textContent = `${h}:${m}:${s}`;
                this.checkSchedules(now);
            };
            update();
            setInterval(update, 1000);
        }

        // ==================== NOTIFICATION PANEL ====================
        setupNotificationPanel() {
            // ... sama
            const btn = document.getElementById('notifBtn');
            const panel = document.getElementById('notifPanel');
            const overlay = document.getElementById('notifOverlay');
            const clearBtn = document.getElementById('clearNotifBtn');

            btn.addEventListener('click', () => {
                panel.classList.toggle('open');
                overlay.classList.toggle('visible');
            });

            overlay.addEventListener('click', () => {
                panel.classList.remove('open');
                overlay.classList.remove('visible');
            });

            clearBtn.addEventListener('click', () => {
                this.notifications = [];
                this.renderNotifications();
                this.updateNotifBadge();
            });
        }

        addNotification(type, message) {
            const now = new Date();
            this.notifications.unshift({
                type,
                message,
                time: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                timestamp: now.getTime(),
            });
            if (this.notifications.length > 50) this.notifications.pop();
            this.renderNotifications();
            this.updateNotifBadge();
        }

        renderNotifications() {
            // ... sama
            const list = document.getElementById('notifList');
            if (this.notifications.length === 0) {
                list.innerHTML = '<div class="activity-empty"><span>🔔</span><p>Tidak ada notifikasi</p></div>';
                return;
            }

            const icons = { warning: '⚠️', danger: '🚨', info: 'ℹ️', success: '✅' };
            list.innerHTML = this.notifications
                .map(
                    (n) => `
                <div class="notif-item">
                    <div class="notif-item-icon ${n.type}">${icons[n.type] || 'ℹ️'}</div>
                    <div class="notif-item-content">
                        <div class="notif-item-text">${n.message}</div>
                        <div class="notif-item-time">${n.time}</div>
                    </div>
                </div>`
                )
                .join('');
        }

        updateNotifBadge() {
            const badge = document.getElementById('notifBadge');
            const count = this.notifications.length;
            badge.textContent = count > 9 ? '9+' : count;
            badge.classList.toggle('hidden', count === 0);
            if (count > 0) {
                badge.classList.remove('pop');
                void badge.offsetWidth;
                badge.classList.add('pop');
            }
        }

        // ==================== ZONE CONTROLS ====================
        setupZoneControls() {
            // Auto toggle switches
            document.querySelectorAll('.auto-toggle').forEach((toggle) => {
                const zoneId = parseInt(toggle.dataset.zone);
                toggle.checked = this.zones[zoneId].autoMode;

                toggle.addEventListener('change', () => {
                    this.zones[zoneId].autoMode = toggle.checked;
                    this.addActivity(
                        'auto',
                        `${toggle.checked ? '🟢' : '🔴'} Mode otomatis <strong>${this.zones[zoneId].name}</strong> ${toggle.checked ? 'diaktifkan' : 'dinonaktifkan'}`
                    );
                    this.saveState();
                    // Send config to ESP32
                    this.sendZoneConfig(zoneId);
                });
            });

            // Manual pump buttons
            document.querySelectorAll('.pump-btn').forEach((btn) => {
                const zoneId = parseInt(btn.dataset.zone);
                btn.addEventListener('click', () => this.togglePump(zoneId, 'manual'));
            });
        }

        // ==================== PUMP CONTROL ====================
        async togglePump(zoneId, source = 'manual') {
            const zone = this.zones[zoneId];
            if (zone.pumpActive) {
                await this.stopPump(zoneId);
            } else {
                await this.startPump(zoneId, zone.waterDuration, source);
            }
        }

        async startPump(zoneId, duration, source = 'auto') {
            const zone = this.zones[zoneId];
            if (zone.pumpActive) return;

            try {
                const response = await fetch(`${this.esp32BaseUrl}/pump`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ zone: zoneId, action: 'on', duration })
                });

                if (!response.ok) throw new Error('ESP32 menolak permintaan');

                // Update local state
                zone.pumpActive = true;
                zone.pumpCountdown = duration;
                zone.lastWatered = new Date();

                // Update UI
                this.updateZoneStatus(zoneId, 'watering', 'Menyiram');
                const btn = document.getElementById(`pumpBtn${zoneId}`);
                if (btn) btn.classList.add('active');
                const card = document.getElementById(`zoneCard${zoneId}`);
                if (card) card.classList.add('watering');

                this.spawnWaterDrops(zoneId);

                // Local countdown (optional, for UI)
                zone.pumpTimer = setInterval(() => {
                    zone.pumpCountdown--;
                    if (zone.pumpCountdown <= 0) {
                        this.stopPump(zoneId);
                    }
                }, 1000);

                const label = source === 'manual' ? 'Manual' : source === 'schedule' ? 'Jadwal' : 'Otomatis';
                this.addActivity('pump', `💧 Pompa <strong>${zone.name}</strong> AKTIF (${label}, ${duration} dtk)`);
                this.addNotification('info', `Pompa ${zone.name} aktif — ${label}`);
                this.showToast('info', `💧 Pompa ${zone.name} aktif`);
                this.saveState();

            } catch (error) {
                console.error('Gagal menyalakan pompa:', error);
                this.showToast('error', `Gagal menyalakan pompa ${zone.name}`);
                this.addActivity('alert', `❌ Gagal menyalakan pompa ${zone.name} — ${error.message}`);
            }
        }

        async stopPump(zoneId) {
            const zone = this.zones[zoneId];
            if (!zone.pumpActive) return;

            try {
                const response = await fetch(`${this.esp32BaseUrl}/pump`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ zone: zoneId, action: 'off' })
                });

                if (!response.ok) throw new Error('ESP32 menolak permintaan');

                zone.pumpActive = false;
                zone.pumpCountdown = 0;
                if (zone.pumpTimer) {
                    clearInterval(zone.pumpTimer);
                    zone.pumpTimer = null;
                }

                // Update UI
                this.updateZoneStatus(zoneId, 'idle', 'Idle');
                const btn = document.getElementById(`pumpBtn${zoneId}`);
                if (btn) btn.classList.remove('active');
                const card = document.getElementById(`zoneCard${zoneId}`);
                if (card) card.classList.remove('watering');

                this.addActivity('pump', `✅ Pompa <strong>${zone.name}</strong> MATI`);
                this.saveState();

            } catch (error) {
                console.error('Gagal mematikan pompa:', error);
                this.showToast('error', `Gagal mematikan pompa ${zone.name}`);
            }
        }

        updateZoneStatus(zoneId, className, text) {
            const el = document.getElementById(`zoneStatus${zoneId}`);
            if (el) {
                el.className = `zone-status ${className}`;
                el.textContent = text;
            }
        }

        spawnWaterDrops(zoneId) {
            // ... sama
            const card = document.getElementById(`zoneCard${zoneId}`);
            if (!card) return;
            for (let i = 0; i < 5; i++) {
                setTimeout(() => {
                    const drop = document.createElement('span');
                    drop.className = 'water-drop';
                    drop.textContent = '💧';
                    drop.style.left = `${20 + Math.random() * 60}%`;
                    drop.style.top = `${10 + Math.random() * 30}%`;
                    card.appendChild(drop);
                    setTimeout(() => drop.remove(), 1000);
                }, i * 200);
            }
        }

        // ==================== AUTOMATION CONTROLS ====================
        setupAutomationControls() {
            // Master auto toggle
            const master = document.getElementById('masterAutoToggle');
            master.checked = this.masterAuto;
            master.addEventListener('change', () => {
                this.masterAuto = master.checked;
                this.addActivity(
                    'auto',
                    `${master.checked ? '🟢' : '🔴'} Master otomatis ${master.checked ? 'diaktifkan' : 'dinonaktifkan'}`
                );
                this.showToast(master.checked ? 'success' : 'warning', `Mode otomatis ${master.checked ? 'aktif' : 'nonaktif'}`);
                this.saveState();
                // Send to ESP32
                this.sendMasterConfig();
            });

            // Threshold sliders
            document.querySelectorAll('.threshold-range').forEach((range) => {
                const zoneId = parseInt(range.dataset.zone);
                range.value = this.zones[zoneId].threshold;
                document.getElementById(`thresholdVal${zoneId}`).textContent = `${range.value}%`;

                range.addEventListener('change', () => { // 'change' fires on mouse up
                    this.zones[zoneId].threshold = parseInt(range.value);
                    document.getElementById(`thresholdVal${zoneId}`).textContent = `${range.value}%`;
                    this.saveState();
                    this.sendZoneConfig(zoneId);
                });
            });

            // Duration sliders
            document.querySelectorAll('.duration-range').forEach((range) => {
                const zoneId = parseInt(range.dataset.zone);
                range.value = this.zones[zoneId].waterDuration;
                document.getElementById(`durationVal${zoneId}`).textContent = `${range.value} dtk`;

                range.addEventListener('change', () => {
                    this.zones[zoneId].waterDuration = parseInt(range.value);
                    document.getElementById(`durationVal${zoneId}`).textContent = `${range.value} dtk`;
                    this.saveState();
                    this.sendZoneConfig(zoneId);
                });
            });
        }

        // ==================== SENSOR POLLING (dari ESP32) ====================
        startSensorPolling() {
            this.updateSensors(); // immediate first fetch
            setInterval(() => this.updateSensors(), this.sensorInterval);
        }

        async updateSensors() {
            try {
                const response = await fetch(`${this.esp32BaseUrl}/status`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();

                // Update master auto from ESP32 (if provided)
                if (data.masterAuto !== undefined) {
                    this.masterAuto = data.masterAuto;
                    document.getElementById('masterAutoToggle').checked = this.masterAuto;
                }

                // Update each zone
                if (data.zones && Array.isArray(data.zones)) {
                    data.zones.forEach((espZone, index) => {
                        const zone = this.zones[index];
                        if (!zone) return;

                        zone.moisture = espZone.moisture || 0;
                        zone.temperature = espZone.temperature || 0;
                        zone.humidity = espZone.humidity || 0;
                        zone.light = espZone.light || 0;
                        zone.pumpActive = espZone.pumpActive || false;
                        zone.lastWatered = espZone.lastWatered ? new Date(espZone.lastWatered) : null;

                        // Store history
                        zone.moistureHistory.push(zone.moisture);
                        zone.tempHistory.push(zone.temperature);
                        zone.humidityHistory.push(zone.humidity);

                        // Cap history (max 2400 = 2 hours at 3s)
                        if (zone.moistureHistory.length > 2400) {
                            zone.moistureHistory.shift();
                            zone.tempHistory.shift();
                            zone.humidityHistory.shift();
                        }

                        // Update UI
                        this.updateZoneUI(zone);
                        this.drawGauge('moisture', zone.id, zone.moisture, 100);
                        this.drawGauge('temp', zone.id, zone.temperature, 50);
                    });

                    // Update stats and chart
                    this.pushChartData();
                    this.updateStatsOverview();
                    this.tick++;
                    if (this.tick % 3 === 0) {
                        this.drawChart();
                    }

                    this.setConnectionStatus(true);
                } else {
                    throw new Error('Format data tidak valid (tidak ada "zones")');
                }

            } catch (error) {
                console.warn('Gagal mengambil data dari ESP32:', error);
                this.setConnectionStatus(false);
                // Optionally show a toast periodically
                if (this.tick % 10 === 0) {
                    this.showToast('error', 'Koneksi ke ESP32 terputus');
                }
            }
        }

        // ==================== UI UPDATE ====================
        updateZoneUI(zone) {
            // Sama seperti sebelumnya
            const i = zone.id;
            const moistureEl = document.getElementById(`gaugeVal-moisture-${i}`);
            const tempEl = document.getElementById(`gaugeVal-temp-${i}`);
            if (moistureEl) moistureEl.textContent = `${zone.moisture.toFixed(1)}%`;
            if (tempEl) tempEl.textContent = `${zone.temperature.toFixed(1)}°C`;

            const humEl = document.getElementById(`reading-humidity-${i}`);
            const lightEl = document.getElementById(`reading-light-${i}`);
            const waterEl = document.getElementById(`reading-lastWater-${i}`);
            if (humEl) humEl.textContent = `${zone.humidity.toFixed(1)}%`;
            if (lightEl) lightEl.textContent = `${zone.light} lux`;
            if (waterEl) {
                waterEl.textContent = zone.lastWatered ? this.timeAgo(zone.lastWatered) : 'Belum pernah';
            }

            if (!zone.pumpActive) {
                if (zone.moisture < zone.threshold * 0.6) {
                    this.updateZoneStatus(i, 'dry', 'Kering!');
                } else {
                    this.updateZoneStatus(i, 'idle', 'Normal');
                }
            } else {
                this.updateZoneStatus(i, 'watering', `Menyiram (${zone.pumpCountdown}s)`);
            }
        }

        updateStatsOverview() {
            // sama
            const avgMoisture = this.zones.reduce((s, z) => s + z.moisture, 0) / this.zones.length;
            const avgTemp = this.zones.reduce((s, z) => s + z.temperature, 0) / this.zones.length;
            const avgHumidity = this.zones.reduce((s, z) => s + z.humidity, 0) / this.zones.length;
            const avgLight = this.zones.reduce((s, z) => s + z.light, 0) / this.zones.length;

            document.getElementById('avgMoisture').textContent = `${avgMoisture.toFixed(1)}`;
            document.getElementById('avgTemp').textContent = `${avgTemp.toFixed(1)}`;
            document.getElementById('avgHumidity').textContent = `${avgHumidity.toFixed(1)}`;
            document.getElementById('avgLight').textContent = `${Math.round(avgLight)}`;

            this.updateTrend('moistureTrend', avgMoisture, this._prevMoisture, '%');
            this.updateTrend('tempTrend', avgTemp, this._prevTemp, '°');
            this.updateTrend('humidityTrend', avgHumidity, this._prevHumidity, '%');
            this.updateTrend('lightTrend', avgLight, this._prevLight, '');

            this._prevMoisture = avgMoisture;
            this._prevTemp = avgTemp;
            this._prevHumidity = avgHumidity;
            this._prevLight = avgLight;
        }

        updateTrend(elementId, current, previous, unit) {
            const el = document.getElementById(elementId);
            if (!el || previous === undefined) return;
            const diff = current - previous;
            const isUp = diff >= 0;
            el.className = `stat-trend ${isUp ? 'up' : 'down'}`;
            el.innerHTML = `<span class="trend-arrow">${isUp ? '↑' : '↓'}</span> <span class="trend-value">${Math.abs(diff).toFixed(1)}${unit}</span>`;
        }

        // ==================== GAUGE ====================
        drawGauge(type, zoneId, value, maxValue) {
            // sama seperti sebelumnya
            const canvas = document.getElementById(`gauge-${type}-${zoneId}`);
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const displayW = 140;
            const displayH = 100;
            canvas.width = displayW * dpr;
            canvas.height = displayH * dpr;
            canvas.style.width = `${displayW}px`;
            canvas.style.height = `${displayH}px`;
            ctx.scale(dpr, dpr);

            const cx = displayW / 2;
            const cy = displayH - 10;
            const radius = 55;
            const lineWidth = 10;
            const startAngle = Math.PI;
            const endAngle = 2 * Math.PI;
            const percent = Math.min(value / maxValue, 1);
            const sweepAngle = startAngle + percent * Math.PI;

            ctx.clearRect(0, 0, displayW, displayH);

            // Background arc
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, endAngle);
            ctx.strokeStyle = this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';
            ctx.stroke();

            if (percent > 0.01) {
                const gradient = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
                if (type === 'moisture') {
                    gradient.addColorStop(0, '#ef4444');
                    gradient.addColorStop(0.35, '#f59e0b');
                    gradient.addColorStop(0.65, '#10b981');
                    gradient.addColorStop(1, '#059669');
                } else {
                    gradient.addColorStop(0, '#3b82f6');
                    gradient.addColorStop(0.5, '#f59e0b');
                    gradient.addColorStop(1, '#ef4444');
                }

                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAngle, sweepAngle);
                ctx.strokeStyle = gradient;
                ctx.lineWidth = lineWidth;
                ctx.lineCap = 'round';
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(cx, cy, radius, startAngle, sweepAngle);
                ctx.strokeStyle = gradient;
                ctx.lineWidth = lineWidth + 6;
                ctx.lineCap = 'round';
                ctx.globalAlpha = 0.15;
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // Tick marks
            for (let i = 0; i <= 10; i++) {
                const angle = startAngle + (i / 10) * Math.PI;
                const innerR = radius - lineWidth / 2 - 6;
                const outerR = radius - lineWidth / 2 - (i % 5 === 0 ? 12 : 9);
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
                ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
                ctx.strokeStyle = this.isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
                ctx.lineWidth = i % 5 === 0 ? 1.5 : 0.8;
                ctx.stroke();
            }
        }

        // ==================== CHART ====================
        setupChartControls() {
            // sama
            document.querySelectorAll('.chip-btn[data-range]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.chip-btn[data-range]').forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.chartRange = btn.dataset.range;
                    this.drawChart();
                });
            });
        }

        seedChartHistory() {
            // Pre-populate with some empty data (will be filled later)
            const points = 120;
            const now = Date.now();
            for (let i = points; i >= 0; i--) {
                const t = new Date(now - i * this.sensorInterval);
                this.chartData.labels.push(t);
                this.chartData.moisture.push(50);
                this.chartData.temp.push(25);
                this.chartData.humidity.push(70);
            }
        }

        pushChartData() {
            const now = new Date();
            this.chartData.labels.push(now);
            const avgM = this.zones.reduce((s, z) => s + z.moisture, 0) / this.zones.length;
            const avgT = this.zones.reduce((s, z) => s + z.temperature, 0) / this.zones.length;
            const avgH = this.zones.reduce((s, z) => s + z.humidity, 0) / this.zones.length;
            this.chartData.moisture.push(avgM);
            this.chartData.temp.push(avgT);
            this.chartData.humidity.push(avgH);

            const maxLen = 28800;
            if (this.chartData.labels.length > maxLen) {
                this.chartData.labels.shift();
                this.chartData.moisture.shift();
                this.chartData.temp.shift();
                this.chartData.humidity.shift();
            }
        }

        drawChart() {
            // sama persis seperti sebelumnya (tidak perlu diubah)
            const canvas = document.getElementById('historyChart');
            if (!canvas || !canvas.offsetParent) return;

            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.parentElement.getBoundingClientRect();
            const W = rect.width - 40;
            const H = 280;

            canvas.width = W * dpr;
            canvas.height = H * dpr;
            canvas.style.width = `${W}px`;
            canvas.style.height = `${H}px`;
            ctx.scale(dpr, dpr);

            let points;
            switch (this.chartRange) {
                case '1h': points = Math.min(1200, this.chartData.moisture.length); break;
                case '6h': points = Math.min(7200, this.chartData.moisture.length); break;
                default: points = this.chartData.moisture.length;
            }

            const startIdx = Math.max(0, this.chartData.moisture.length - points);
            const moistureData = this.chartData.moisture.slice(startIdx);
            const tempData = this.chartData.temp.slice(startIdx);
            const humidityData = this.chartData.humidity.slice(startIdx);
            const labelData = this.chartData.labels.slice(startIdx);

            if (moistureData.length < 2) return;

            const padding = { top: 20, right: 16, bottom: 36, left: 42 };
            const chartW = W - padding.left - padding.right;
            const chartH = H - padding.top - padding.bottom;

            ctx.clearRect(0, 0, W, H);

            const gridColor = this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
            const textColor = this.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'right';

            const ySteps = 5;
            for (let i = 0; i <= ySteps; i++) {
                const y = padding.top + (chartH / ySteps) * i;
                const val = Math.round(100 - (100 / ySteps) * i);
                ctx.beginPath();
                ctx.moveTo(padding.left, y);
                ctx.lineTo(W - padding.right, y);
                ctx.strokeStyle = gridColor;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.fillStyle = textColor;
                ctx.fillText(`${val}`, padding.left - 8, y + 3);
            }

            ctx.textAlign = 'center';
            const xLabels = 6;
            for (let i = 0; i <= xLabels; i++) {
                const idx = Math.floor((labelData.length - 1) * (i / xLabels));
                const x = padding.left + (chartW * i) / xLabels;
                const time = labelData[idx];
                if (time) {
                    const h = String(time.getHours()).padStart(2, '0');
                    const m = String(time.getMinutes()).padStart(2, '0');
                    ctx.fillStyle = textColor;
                    ctx.fillText(`${h}:${m}`, x, H - padding.bottom + 18);
                }
            }

            const mapY = (val, min, max) => {
                const ratio = (val - min) / (max - min);
                return padding.top + chartH - ratio * chartH;
            };

            const drawLine = (data, color, alpha, min, max) => {
                if (data.length < 2) return;
                const step = chartW / (data.length - 1);
                let drawData = data;
                let drawStep = step;
                if (data.length > 500) {
                    const factor = Math.ceil(data.length / 500);
                    drawData = data.filter((_, idx) => idx % factor === 0);
                    drawStep = chartW / (drawData.length - 1);
                }

                ctx.beginPath();
                ctx.moveTo(padding.left, mapY(drawData[0], min, max));
                for (let i = 1; i < drawData.length; i++) {
                    const x = padding.left + i * drawStep;
                    const y = mapY(drawData[i], min, max);
                    const px = padding.left + (i - 1) * drawStep;
                    const py = mapY(drawData[i - 1], min, max);
                    const cpx = (px + x) / 2;
                    ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
                }
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.stroke();

                const lastX = padding.left + (drawData.length - 1) * drawStep;
                ctx.lineTo(lastX, padding.top + chartH);
                ctx.lineTo(padding.left, padding.top + chartH);
                ctx.closePath();
                const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
                grad.addColorStop(0, color.replace(')', `,${alpha})`).replace('rgb', 'rgba'));
                grad.addColorStop(1, color.replace(')', ',0)').replace('rgb', 'rgba'));
                ctx.fillStyle = grad;
                ctx.fill();
            };

            drawLine(moistureData, 'rgb(16, 185, 129)', 0.12, 0, 100);
            drawLine(humidityData, 'rgb(59, 130, 246)', 0.08, 0, 100);
            drawLine(tempData.map((t) => (t / 50) * 100), 'rgb(245, 158, 11)', 0.06, 0, 100);
        }

        // ==================== SCHEDULE ====================
        setupSchedule() {
            // sama
            const form = document.getElementById('scheduleForm');
            const dayBtns = document.querySelectorAll('.day-btn');

            dayBtns.forEach((btn) => {
                btn.addEventListener('click', () => btn.classList.toggle('active'));
            });

            form.addEventListener('submit', (e) => {
                e.preventDefault();

                const zone = parseInt(document.getElementById('schedZone').value);
                const time = document.getElementById('schedTime').value;
                const duration = parseInt(document.getElementById('schedDuration').value);
                const days = Array.from(dayBtns)
                    .filter((b) => b.classList.contains('active'))
                    .map((b) => parseInt(b.dataset.day));

                if (days.length === 0) {
                    this.showToast('warning', 'Pilih minimal satu hari aktif');
                    return;
                }

                const schedule = {
                    id: Date.now(),
                    zone,
                    time,
                    duration,
                    days,
                    active: true,
                    lastTriggered: null,
                };

                this.schedules.push(schedule);
                this.renderSchedules();
                this.addActivity('schedule', `📅 Jadwal baru ditambahkan untuk <strong>${this.zones[zone].name}</strong> pukul ${time}`);
                this.showToast('success', `Jadwal berhasil ditambahkan`);
                this.saveState();

                form.reset();
                document.getElementById('schedTime').value = '06:00';
                document.getElementById('schedDuration').value = '30';
                dayBtns.forEach((b) => b.classList.add('active'));
            });

            this.renderSchedules();
        }

        renderSchedules() {
            // sama
            const list = document.getElementById('scheduleList');
            const badge = document.getElementById('scheduleCountBadge');
            badge.textContent = `${this.schedules.length} Jadwal`;

            if (this.schedules.length === 0) {
                list.innerHTML = '<div class="activity-empty"><span>📅</span><p>Belum ada jadwal penyiraman</p></div>';
                return;
            }

            const dayNames = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

            list.innerHTML = this.schedules
                .map(
                    (sched) => `
                <div class="schedule-item" data-id="${sched.id}">
                    <div class="schedule-time-display">${sched.time}</div>
                    <div class="schedule-details">
                        <div class="schedule-zone-name">${this.zones[sched.zone].emoji} ${this.zones[sched.zone].name}</div>
                        <div class="schedule-meta">Durasi: ${sched.duration} detik</div>
                        <div class="schedule-days">
                            ${dayNames
                                .map(
                                    (d, idx) =>
                                        `<span class="schedule-day-tag ${sched.days.includes(idx) ? '' : 'inactive'}">${d}</span>`
                                )
                                .join('')}
                        </div>
                    </div>
                    <div class="schedule-actions">
                        <button class="schedule-toggle-btn ${sched.active ? '' : 'off'}" data-id="${sched.id}" title="${sched.active ? 'Nonaktifkan' : 'Aktifkan'}">
                            ${sched.active ? '⏸️' : '▶️'}
                        </button>
                        <button class="schedule-delete-btn" data-id="${sched.id}" title="Hapus">🗑️</button>
                    </div>
                </div>`
                )
                .join('');

            list.querySelectorAll('.schedule-toggle-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = parseInt(btn.dataset.id);
                    const sched = this.schedules.find((s) => s.id === id);
                    if (sched) {
                        sched.active = !sched.active;
                        this.renderSchedules();
                        this.saveState();
                    }
                });
            });

            list.querySelectorAll('.schedule-delete-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const id = parseInt(btn.dataset.id);
                    this.schedules = this.schedules.filter((s) => s.id !== id);
                    this.renderSchedules();
                    this.showToast('success', 'Jadwal dihapus');
                    this.saveState();
                });
            });
        }

        checkSchedules(now) {
            // sama
            const currentH = String(now.getHours()).padStart(2, '0');
            const currentM = String(now.getMinutes()).padStart(2, '0');
            const currentTime = `${currentH}:${currentM}`;
            const currentDay = (now.getDay() + 6) % 7;
            const currentSec = now.getSeconds();

            this.schedules.forEach((sched) => {
                if (!sched.active) return;
                if (sched.time !== currentTime) return;
                if (!sched.days.includes(currentDay)) return;
                if (currentSec !== 0) return;

                const lastKey = `${sched.id}_${currentTime}_${now.toDateString()}`;
                if (sched.lastTriggered === lastKey) return;
                sched.lastTriggered = lastKey;

                const zone = this.zones[sched.zone];
                if (!zone.pumpActive) {
                    this.startPump(sched.zone, sched.duration, 'schedule');
                    this.addActivity('schedule', `📅 Jadwal aktif: <strong>${zone.name}</strong> pukul ${sched.time}`);
                    this.addNotification('info', `📅 Jadwal penyiraman ${zone.name} aktif (${sched.duration} dtk)`);
                }
            });
        }

        // ==================== SETTINGS ====================
        setupSettings() {
            // Sensor interval slider
            const intervalRange = document.getElementById('settInterval');
            const intervalVal = document.getElementById('settIntervalVal');
            intervalRange.addEventListener('input', () => {
                intervalVal.textContent = `${intervalRange.value} dtk`;
            });
            intervalRange.addEventListener('change', () => {
                const newInterval = parseInt(intervalRange.value) * 1000;
                this.sensorInterval = newInterval;
                // Restart polling
                clearInterval(this._pollInterval);
                this._pollInterval = setInterval(() => this.updateSensors(), this.sensorInterval);
                this.saveState();
            });

            // History duration (just UI, no real effect)
            const histRange = document.getElementById('settHistory');
            const histVal = document.getElementById('settHistoryVal');
            histRange.addEventListener('input', () => {
                histVal.textContent = `${histRange.value} jam`;
            });

            // Reset button
            document.getElementById('resetSettingsBtn').addEventListener('click', () => {
                if (confirm('Reset semua pengaturan ke default?')) {
                    localStorage.removeItem('gh_state');
                    localStorage.removeItem('gh_esp32_ip');
                    location.reload();
                }
            });

            // Clear log
            document.getElementById('clearLogBtn').addEventListener('click', () => {
                this.activityLog = [];
                this.renderActivityLog();
                this.saveState();
            });

            // ESP32 IP Address input
            const ipInput = document.getElementById('settIP');
            ipInput.addEventListener('change', () => {
                const ip = ipInput.value.trim();
                if (ip) {
                    this.esp32BaseUrl = `http://${ip}`;
                    localStorage.setItem('gh_esp32_ip', ip);
                    this.showToast('info', `IP ESP32 diperbarui ke ${ip}`);
                    // Attempt to reconnect
                    this.updateSensors();
                }
            });
        }

        // ==================== ACTIVITY LOG ====================
        addActivity(type, message) {
            // sama
            const now = new Date();
            this.activityLog.unshift({
                type,
                message,
                time: now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                timestamp: now.getTime(),
            });
            if (this.activityLog.length > 100) this.activityLog.pop();
            this.renderActivityLog();
        }

        renderActivityLog() {
            // sama
            const list = document.getElementById('activityList');
            if (this.activityLog.length === 0) {
                list.innerHTML = '<div class="activity-empty"><span>📭</span><p>Belum ada aktivitas tercatat</p></div>';
                return;
            }
            const icons = {
                pump: '💧',
                alert: '⚠️',
                auto: '🤖',
                schedule: '📅',
                system: '⚙️',
            };
            list.innerHTML = this.activityLog
                .slice(0, 30)
                .map(
                    (item) => `
                <div class="activity-item">
                    <div class="activity-icon ${item.type}">${icons[item.type] || '📌'}</div>
                    <div class="activity-text">${item.message}</div>
                    <div class="activity-time">${item.time}</div>
                </div>`
                )
                .join('');
        }

        // ==================== TOAST ====================
        showToast(type, message) {
            // sama
            const container = document.getElementById('toastContainer');
            const icons = { success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️' };
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerHTML = `
                <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
                <span class="toast-message">${message}</span>
            `;
            container.appendChild(toast);
            setTimeout(() => toast.remove(), 4200);
        }

        // ==================== PERSISTENCE ====================
        saveState() {
            const state = {
                zones: this.zones.map((z) => ({
                    threshold: z.threshold,
                    waterDuration: z.waterDuration,
                    autoMode: z.autoMode,
                    lastWatered: z.lastWatered ? z.lastWatered.getTime() : null,
                })),
                masterAuto: this.masterAuto,
                schedules: this.schedules,
                activityLog: this.activityLog.slice(0, 50),
                sensorInterval: this.sensorInterval / 1000,
            };
            try {
                localStorage.setItem('gh_state', JSON.stringify(state));
            } catch (e) {}
        }

        loadState() {
            try {
                const raw = localStorage.getItem('gh_state');
                if (!raw) return;
                const state = JSON.parse(raw);

                if (state.zones) {
                    state.zones.forEach((saved, i) => {
                        if (this.zones[i]) {
                            this.zones[i].threshold = saved.threshold || this.zones[i].threshold;
                            this.zones[i].waterDuration = saved.waterDuration || this.zones[i].waterDuration;
                            this.zones[i].autoMode = saved.autoMode !== undefined ? saved.autoMode : true;
                            this.zones[i].lastWatered = saved.lastWatered ? new Date(saved.lastWatered) : null;
                        }
                    });
                }

                if (state.masterAuto !== undefined) this.masterAuto = state.masterAuto;
                if (state.schedules) this.schedules = state.schedules;
                if (state.activityLog) {
                    this.activityLog = state.activityLog;
                    this.renderActivityLog();
                }
                if (state.sensorInterval) {
                    this.sensorInterval = state.sensorInterval * 1000;
                    document.getElementById('settInterval').value = state.sensorInterval;
                    document.getElementById('settIntervalVal').textContent = `${state.sensorInterval} dtk`;
                }
            } catch (e) {}
        }

        // ==================== ESP32 CONFIGURATION ====================
        loadESP32IP() {
            const savedIP = localStorage.getItem('gh_esp32_ip');
            if (savedIP) {
                this.esp32BaseUrl = `http://${savedIP}`;
            }
            const ipInput = document.getElementById('settIP');
            if (ipInput) {
                ipInput.value = savedIP || '192.168.1.100';
            }
        }

        setConnectionStatus(connected) {
            this.esp32Connected = connected;
            const dot = document.getElementById('connectionDot');
            const text = document.getElementById('connectionText');
            if (connected) {
                dot.className = 'status-dot';
                text.textContent = 'Terhubung';
                text.style.color = 'var(--emerald-500)';
            } else {
                dot.className = 'status-dot offline';
                text.textContent = 'Terputus';
                text.style.color = 'var(--red-500)';
            }
        }

        async sendZoneConfig(zoneId) {
            try {
                const zone = this.zones[zoneId];
                const response = await fetch(`${this.esp32BaseUrl}/config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        zone: zoneId,
                        threshold: zone.threshold,
                        duration: zone.waterDuration,
                        autoMode: zone.autoMode
                    })
                });
                if (!response.ok) throw new Error('Gagal kirim konfigurasi');
            } catch (error) {
                console.warn('Gagal mengirim konfigurasi ke ESP32:', error);
            }
        }

        async sendMasterConfig() {
            try {
                const response = await fetch(`${this.esp32BaseUrl}/config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        masterAuto: this.masterAuto
                    })
                });
                if (!response.ok) throw new Error('Gagal kirim master auto');
            } catch (error) {
                console.warn('Gagal mengirim master auto ke ESP32:', error);
            }
        }

        // ==================== UTILITIES ====================
        timeAgo(date) {
            const seconds = Math.floor((new Date() - date) / 1000);
            if (seconds < 60) return `${seconds} dtk lalu`;
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return `${minutes} mnt lalu`;
            const hours = Math.floor(minutes / 60);
            if (hours < 24) return `${hours} jam lalu`;
            return `${Math.floor(hours / 24)} hari lalu`;
        }
    }

    // ==================== BOOT ====================
    document.addEventListener('DOMContentLoaded', () => {
        window.ghApp = new GreenHouseApp();
    });
})();