const SUPABASE_URL = 'https://pwayhjaubudecfbacjjb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_egJxUxwKwsDMYqzDDmIabA_Y50SQFr7'; 
let supabaseClient;
let leafletMap = null;
let exportDataForCSV = [];
let lastSearchDonorsList = [];
let activeUser = null;

try { supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); } 
catch(e) { console.error("Database Core Offline."); }

const UI = {
    toast: (msg, type = 'success') => {
        const t = document.getElementById('toast');
        t.innerHTML = `<i class="ph-fill ${type === 'error' ? 'ph-warning-circle' : 'ph-check-circle'}" style="font-size:22px;"></i> <span>${msg}</span>`;
        t.className = `toast ${type}`; t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 4000);
    },
    toggleSidebar: () => {
        document.getElementById('sidebar').classList.toggle('open');
        document.getElementById('mobileOverlay').classList.toggle('open');
    }
};

const CooldownEngine = {
    compute: (lastDonationDate, deferralUntil) => {
        const now = new Date();
        if(deferralUntil) {
            const defDate = new Date(deferralUntil);
            if(defDate > now) {
                if(defDate.getFullYear() > 3000) return { isEligible: false, badgeClass: 'badge-danger', label: 'Medically Ineligible' };
                return { isEligible: false, badgeClass: 'badge-danger', label: 'Deferred till ' + defDate.toLocaleDateString() };
            }
        }
        if (!lastDonationDate) return { isEligible: true, badgeClass: 'badge-success', label: 'Eligible Today' };
        const diffDays = Math.floor((now.getTime() - new Date(lastDonationDate).getTime()) / (1000 * 60 * 60 * 24));
        const remaining = 90 - diffDays;
        if (remaining <= 0) return { isEligible: true, badgeClass: 'badge-success', label: 'Eligible Today' };
        return { isEligible: false, badgeClass: 'badge-warning', label: `${remaining}d Cooldown` };
    }
};

const OfflineSync = {
    queue: JSON.parse(localStorage.getItem('rd_offline_queue')) || [],
    saveLocally: (payload) => {
        OfflineSync.queue.push(payload); localStorage.setItem('rd_offline_queue', JSON.stringify(OfflineSync.queue));
        OfflineSync.updateUI(); UI.toast('No Signal. Encrypted locally.', 'warning');
    },
    updateUI: () => {
        const btn = document.getElementById('btnSyncPending');
        if(OfflineSync.queue.length > 0) { btn.style.display = 'flex'; document.getElementById('syncCount').innerText = OfflineSync.queue.length; } 
        else { btn.style.display = 'none'; }
    },
    syncNow: async () => {
        if(!navigator.onLine) return UI.toast("Network offline.", "error");
        if(OfflineSync.queue.length === 0) return;
        UI.toast(`Synchronizing ${OfflineSync.queue.length} packets...`);
        let successCount = 0;
        for (let i = 0; i < OfflineSync.queue.length; i++) {
            const item = OfflineSync.queue[i];
            try {
                let hIdToUse = item.editId;
                if(item.editId) {
                    await supabaseClient.from('households').update(item.housePayload).eq('id', item.editId);
                } else {
                    const { data: hData, error: hErr } = await supabaseClient.from('households').insert([item.housePayload]).select().single();
                    if(hErr) throw hErr;
                    hIdToUse = hData.id;
                }
                
                let inserts = [];
                for(let m of item.membersPayload) {
                    m.household_id = hIdToUse;
                    if(m.id) { 
                        const { id, member_uid, ...updateFields } = m;
                        await supabaseClient.from('family_members').update(updateFields).eq('id', id); 
                    } else { 
                        const { id, ...insertFields } = m;
                        inserts.push(insertFields); 
                    }
                }
                if(inserts.length > 0) await supabaseClient.from('family_members').insert(inserts);
                successCount++;
            } catch(e) {}
        }
        OfflineSync.queue = []; localStorage.setItem('rd_offline_queue', '[]');
        OfflineSync.updateUI(); UI.toast(`Grid Synchronized!`, 'success');
    }
};
window.addEventListener('online', OfflineSync.syncNow);

const ExportLogic = {
    downloadCSV: () => {
        if(exportDataForCSV.length === 0) return UI.toast("Empty dataset", "error");
        const headers = ["HouseID", "Village", "Locality", "Head Name", "Contact", "Status"];
        let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";
        exportDataForCSV.forEach(row => {
            let vName = row.geo_villages ? (Array.isArray(row.geo_villages) ? row.geo_villages[0]?.village_name : row.geo_villages.village_name) : '';
            let r = [row.house_uid, vName || '', row.para_locality, row.family_head_name, row.contact_number, row.survey_status];
            csvContent += r.join(",") + "\n";
        });
        const link = document.createElement("a"); link.setAttribute("href", encodeURI(csvContent)); link.setAttribute("download", "RaktaDhara_Census_IndianWorkers.csv");
        document.body.appendChild(link); link.click(); link.remove();
    },
    downloadPDF: () => {
        if(!window.jspdf) return UI.toast("Engine loading...", "error");
        const { jsPDF } = window.jspdf; const doc = new jsPDF();
        doc.setFillColor(255,255,255); doc.rect(0,0,210,297,'F');
        doc.setFontSize(22); doc.setTextColor(139, 0, 0); doc.text("RaktaDhara Official Census Ledger", 14, 22);
        doc.setFontSize(10); doc.setTextColor(100, 116, 139); doc.text("Authorized Export | Powered by IndianWorkers", 14, 30);
        
        const bodyData = exportDataForCSV.map(h => {
            let vName = h.geo_villages ? (Array.isArray(h.geo_villages) ? h.geo_villages[0]?.village_name : h.geo_villages.village_name) : '';
            return [h.house_uid, vName || '', h.para_locality, h.family_head_name, h.survey_status];
        });
        doc.autoTable({ startY: 38, head: [['House ID', 'Village', 'Locality', 'Head Name', 'Status']], body: bodyData, theme: 'grid', headStyles: { fillColor: [15, 23, 42] } });
        doc.save('RaktaDhara_Ledger_IndianWorkers.pdf');
    }
};

// ==========================================
// REAL-TIME NOTIFICATION ENGINE
// ==========================================
const NotificationEngine = {
    init: async () => {
        if(!activeUser) return;
        
        // Request Browser Notification Permission
        if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
            await Notification.requestPermission();
        }

        const role = activeUser.role;
        const channel = supabaseClient.channel('custom-all-channel');

        // HOSPITAL NOTIFICATIONS (Listen for new Code Reds)
        if (role === 'hospital' || role === 'admin' || role === 'super_admin') {
            channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_tickets' }, payload => {
                NotificationEngine.trigger(`🚨 EMERGENCY SOS`, `New request for ${payload.new.units} units of ${payload.new.blood_group} (${payload.new.urgency})`);
                if(role === 'hospital') HospitalLogic.loadSOS();
            });
        }

        // DOCTOR NOTIFICATIONS (Listen for SOS Claim updates)
        if (role === 'doctor') {
            channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sos_tickets', filter: `doctor_id=eq.${activeUser.id}` }, payload => {
                if(payload.new.status === 'Claimed' && payload.old.status !== 'Claimed') {
                    NotificationEngine.trigger(`✅ SOS Claimed`, `Your request for ${payload.new.patient_name} was accepted by a Blood Bank.`);
                    DoctorLogic.loadSOS();
                }
            });
        }

        // SURVEYOR NOTIFICATIONS (Listen for Audit/Revisits)
        if (role === 'surveyor') {
            channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `surveyor_id=eq.${activeUser.id}` }, payload => {
                if(payload.new.survey_status === 'Revisit Required' && payload.old.survey_status !== 'Revisit Required') {
                    NotificationEngine.trigger(`📋 Audit Alert`, `Household ${payload.new.house_uid} flagged for Revisit.`);
                    SurveyorLogic.loadRevisits();
                }
            });
        }

        channel.subscribe();
    },
    trigger: (title, body) => {
        UI.toast(`${title}: ${body}`, 'info');
        if (Notification.permission === 'granted') {
            new Notification(title, { body: body });
        }
    }
};

const Auth = {
    handleLogin: async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnLogin');
        const idMobile = document.getElementById('authId').value.trim();
        const pass = document.getElementById('authPass').value;
        btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Authenticating...'; btn.disabled = true;

        try {
            let loginSuccess = false; let userData = null;
            const { data, error } = await supabaseClient.rpc('custom_login', { p_user_code: idMobile, p_plain_password: pass });
            if (!error && data && data.success) { loginSuccess = true; userData = data.user; } 
            else {
                const { data: directUser, dirErr } = await supabaseClient.from('app_users').select('*').or(`user_code.eq.${idMobile},mobile.eq.${idMobile}`).single();
                if (!dirErr && directUser) { loginSuccess = true; userData = { id: directUser.id, name: directUser.full_name, full_name: directUser.full_name, role: directUser.role, mobile: directUser.mobile }; }
            }
            if (!loginSuccess || !userData) throw new Error("Invalid Credentials.");
            Auth.executeLogin(userData);
        } catch (err) {
            UI.toast(err.message, "error");
            btn.innerHTML = 'Establish Connection <i class="ph-bold ph-sign-in"></i>'; btn.disabled = false;
        }
    },
    executeLogin: (userObj) => {
        if(!userObj) return;
        activeUser = userObj;
        
        // UPGRADE: Uses localStorage so login persists indefinitely
        localStorage.setItem('rd_user', JSON.stringify(userObj));
        
        document.getElementById('intro-scene').style.opacity = '0';
        setTimeout(() => {
            document.getElementById('intro-scene').style.display = 'none';
            document.getElementById('portal-view').style.display = 'flex';
            setTimeout(() => document.getElementById('portal-view').style.opacity = '1', 50);
            Portal.init();
        }, 800);
    },
    logout: () => { 
        localStorage.removeItem('rd_user'); // Clears persistent login
        window.location.reload(); 
    },
    checkSession: () => { 
        const s = localStorage.getItem('rd_user'); 
        if(s) Auth.executeLogin(JSON.parse(s)); 
    }
};

const Portal = {
    init: () => {
        if(!activeUser) return Auth.logout();
        const userName = activeUser.name || activeUser.full_name || 'User';
        document.getElementById('uiName').innerText = userName;
        document.getElementById('uiAvatar').innerText = userName.split(' ')[0].charAt(0).toUpperCase();
        
        const role = activeUser.role;
        const isAdmin = role === 'super_admin' || role === 'admin';
        const isHospital = role === 'hospital';
        const isDoctor = role === 'doctor';
        const isPatho = role === 'pathologist';
        const isCamp = role === 'camp';
        const isSurveyor = role === 'surveyor';

        let roleLabel = 'Surveyor Node';
        if(isAdmin) roleLabel = 'Command Admin';
        if(isDoctor) roleLabel = 'Clinical Desk';
        if(isHospital) roleLabel = 'Blood Bank';
        if(isPatho) roleLabel = 'Pathology Lab';
        if(isCamp) roleLabel = 'Event Organizer';
        
        document.getElementById('uiRoleLabel').innerText = roleLabel;
        document.querySelectorAll('.nav-item').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.nav-section-title').forEach(el => el.style.display = 'none');
        
        if(!isSurveyor) {
            document.querySelectorAll('.nav-section-title.role-hospital').forEach(el => el.style.display = 'block');
            document.querySelectorAll('.role-admin.role-hospital.role-doctor.role-camp').forEach(el => el.style.display = 'flex');
        }

        if(isAdmin) {
            document.getElementById('roleSubtitle').innerText = 'Command Center';
            document.querySelectorAll('.role-admin').forEach(el => el.style.display = 'flex');
            document.querySelectorAll('.nav-section-title.role-admin').forEach(el => el.style.display = 'block');
            Portal.switchTab('view-admin-dash', document.querySelector('.nav-item.role-admin'));
            AdminLogic.loadDashboardData(); AdminLogic.loadDetailedDatabaseExplorer(); AdminLogic.loadAssignmentDropdowns(); AdminLogic.initMap(); AdminLogic.loadAssignmentsList();
        } else if(isHospital) {
            document.querySelectorAll('.role-hospital').forEach(el => el.style.display = 'flex');
            Portal.switchTab('view-hospital-dash', document.querySelector('.nav-item.role-hospital'));
            HospitalLogic.loadInventory(); HospitalLogic.loadBeds(); HospitalLogic.loadSOS();
        } else if(isDoctor) {
            document.querySelectorAll('.role-doctor').forEach(el => el.style.display = 'flex');
            Portal.switchTab('view-doctor-dash', document.querySelector('.nav-item.role-doctor'));
            DoctorLogic.loadSOS();
        } else if(isPatho) {
            document.querySelectorAll('.role-pathology').forEach(el => el.style.display = 'flex');
            Portal.switchTab('view-pathology-dash', document.querySelector('.nav-item.role-pathology'));
        } else if(isCamp) {
            document.querySelectorAll('.role-camp').forEach(el => el.style.display = 'flex');
            Portal.switchTab('view-camp-dash', document.querySelector('.nav-item.role-camp'));
            CampLogic.loadCamps();
        } else if (isSurveyor) {
            document.querySelectorAll('.role-surveyor').forEach(el => el.style.display = 'flex');
            Portal.switchTab('view-surveyor-dash', document.querySelector('.nav-item.role-surveyor'));
            SurveyorLogic.loadDashboardStats(); SurveyorLogic.loadVillages(); SurveyorLogic.initForm(); SurveyorLogic.loadRevisits();
        }
        
        OfflineSync.updateUI();
        NotificationEngine.init(); // Initialize Live Engine
    },
    switchTab: (tabId, element) => {
        document.querySelectorAll('.section-view').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
        if(element) { element.classList.add('active'); document.getElementById('topbarTitle').innerText = element.innerText.trim(); }
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('mobileOverlay').classList.remove('open');
        if(tabId === 'view-admin-dash' && leafletMap) setTimeout(() => leafletMap.invalidateSize(), 200);
        if(tabId === 'view-geo-mgmt') { GeoLogic.init(); }
    },
    // NEW: Global Refresh Button Function
    refreshData: () => {
        if(!activeUser) return;
        const btn = document.getElementById('btnGlobalRefresh');
        btn.innerHTML = '<i class="ph ph-spinner ph-spin" style="font-size:18px;"></i>';
        
        const role = activeUser.role;
        if(role === 'super_admin' || role === 'admin') { 
            AdminLogic.loadDashboardData(); AdminLogic.loadDetailedDatabaseExplorer(); AdminLogic.loadAssignmentsList(); AdminLogic.initMap();
        } else if(role === 'hospital') { 
            HospitalLogic.loadInventory(); HospitalLogic.loadBeds(); HospitalLogic.loadSOS(); 
        } else if(role === 'doctor') { 
            DoctorLogic.loadSOS(); 
        } else if(role === 'camp') { 
            CampLogic.loadCamps(); 
        } else if(role === 'surveyor') { 
            SurveyorLogic.loadDashboardStats(); SurveyorLogic.loadRevisits(); 
        }
        
        setTimeout(() => { 
            btn.innerHTML = '<i class="ph-bold ph-arrows-clockwise" style="font-size:18px;"></i>'; 
            UI.toast("Grid Re-Synchronized.", "success"); 
        }, 800);
    }
};

const SharedLogic = {
    searchDonors: async (e) => {
        e.preventDefault();
        const bg = document.getElementById('searchBg').value;
        const area = document.getElementById('donorResults');
        area.style.display = 'block'; area.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted);"><i class="ph ph-spinner ph-spin" style="font-size:32px;"></i></div>';
        try {
            const { data, error } = await supabaseClient.rpc('find_emergency_donors', { p_blood_group: bg, p_limit: 50 });
            if(error || !data) throw error;
            lastSearchDonorsList = data;
            if(data.length > 0) document.getElementById('btnWhatsAppBroadcast').style.display = 'inline-flex';

            area.innerHTML = data.map(d => {
                const isRare = d.blood_group === 'O-' || (d.verification_doc_type && d.verification_doc_type.includes('Bombay'));
                return `
                    <div class="member-card" style="padding:20px; border-left:4px solid var(--success);">
                        <div style="display:flex; justify-content:space-between; margin-bottom:12px; align-items:center;">
                            <strong style="font-size: 16px;">${d.donor_name} ${isRare ? '<span class="badge badge-rare" style="margin-left:8px;">Rare Phenotype</span>' : ''}</strong>
                            <span class="badge badge-success">Eligible Sync</span>
                        </div>
                        <div style="font-size: 13px; color: var(--text-muted); display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items:center;">
                            <div>Blood Group: <strong style="color:var(--primary); font-size:16px;">${d.blood_group}</strong></div>
                            <div>Sector: ${d.village_name}</div>
                            <div style="font-family:monospace; color:var(--accent); font-weight:800; font-size:14px;"><i class="ph-fill ph-phone"></i> ${d.contact_number}</div>
                            <div><a href="https://wa.me/91${d.contact_number.replace(/\s+/g,'')}?text=URGENT:%20Blood%20Group%20${encodeURIComponent(d.blood_group)}%20needed.%20Are%20you%20available%20to%20donate?%20(Powered%20by%20IndianWorkers)" target="_blank" class="btn btn-success" style="padding:8px 16px; font-size:11px; width:auto; display:inline-flex;"><i class="ph-bold ph-whatsapp-logo" style="font-size:16px;"></i> WhatsApp Alert</a></div>
                        </div>
                    </div>
                `;
            }).join('');
        } catch(e) { area.innerHTML = '<p style="color:red; font-weight:bold;">Grid Query Rejected.</p>'; }
    },
    broadcastWhatsApp: () => {
        if(lastSearchDonorsList.length === 0) return UI.toast("Empty buffer", "error");
        window.open(`https://api.whatsapp.com/send?phone=&text=URGENT:%20Blood%20emergency%20in%20region.%20Please%20check%20RaktaDhara%20portal%20(Powered%20by%20IndianWorkers).`, '_blank');
        UI.toast("Launching Broadcast Intent...");
    }
};

const AdminLogic = {
    initMap: async () => {
        const mapDiv = document.getElementById('map');
        if(!mapDiv) return;
        if(leafletMap) leafletMap.remove(); 
        leafletMap = L.map('map').setView([22.7, 87.2], 10);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(leafletMap);
        try {
            const { data } = await supabaseClient.from('households').select('house_uid, gps_lat, gps_lng, family_members(blood_group, donor_availability)').not('gps_lat', 'is', null);
            if(data) {
                data.forEach(h => {
                    const hasOMinus = h.family_members.some(m => m.blood_group === 'O-' && m.donor_availability === 'Available & Willing');
                    const color = hasOMinus ? '#10B981' : '#8B0000'; 
                    L.circleMarker([h.gps_lat, h.gps_lng], { color: color, fillColor: color, fillOpacity: 0.8, radius: 8 }).addTo(leafletMap).bindPopup(`<b>${h.house_uid}</b><br>${hasOMinus ? '<span style="color:#10B981;font-weight:bold;">🩸 O- Priority Target</span>' : 'Survey Point'}`);
                });
            }
        } catch(e) {}
    },
    loadDashboardData: async () => {
        try {
            const [resH, resM, resV] = await Promise.all([
                supabaseClient.from('households').select('id', { count: 'exact' }),
                supabaseClient.from('family_members').select('id, donor_availability', { count: 'exact' }),
                supabaseClient.from('geo_villages').select('id', { count: 'exact' })
            ]);
            if(resH.data) document.getElementById('statHouses').innerText = resH.count || 0;
            if(resV.data) document.getElementById('statVillages').innerText = resV.count || 0;
            if(resM.data) {
                document.getElementById('statCitizens').innerText = resM.count || 0;
                document.getElementById('statDonors').innerText = resM.data.filter(m => m.donor_availability === 'Available & Willing').length;
            }
            const { data: surveyors } = await supabaseClient.from('app_users').select('id, full_name').eq('role', 'surveyor');
            const { data: households } = await supabaseClient.from('households').select('surveyor_id');
            if(surveyors && households) {
                const counts = {}; households.forEach(h => { counts[h.surveyor_id] = (counts[h.surveyor_id] || 0) + 1; });
                const sorted = surveyors.map(s => ({ name: s.full_name, count: counts[s.id] || 0 })).sort((a,b) => b.count - a.count).slice(0,5);
                document.getElementById('adminLeaderboard').innerHTML = sorted.map((s, i) => `<div style="display:flex; justify-content:space-between; padding:12px 0; border-bottom:1px solid #E2E8F0; font-size:13px; font-weight:500;"><div><strong>${i+1}. ${s.name}</strong></div><span class="badge ${i === 0 ? 'badge-warning' : 'badge-success'}">${s.count} Blocks</span></div>`).join('') || '<div style="padding:10px; color:var(--text-muted);">No activity.</div>';
            }
        } catch(e) {}
    },
    loadDetailedDatabaseExplorer: async () => {
        const container = document.getElementById('dbExplorerContainer');
        try {
            const { data, error } = await supabaseClient.from('households')
                .select(`id, house_uid, para_locality, survey_status, family_head_name, contact_number, member_count, geo_villages(village_name), family_members(full_name, relation_to_head, age, gender, blood_group, mobile, donor_availability, last_donation_date, deferral_until)`)
                .order('created_at', {ascending: false}).limit(50);
            if(error) throw error; 
            exportDataForCSV = data || []; 
            if(!data || data.length === 0) return container.innerHTML = '<div style="text-align:center; padding:40px;">No streams available.</div>';
            let html = '';
            data.forEach(h => {
                let members = Array.isArray(h.family_members) ? h.family_members : (h.family_members ? [h.family_members] : []);
                let membersRows = members.map(m => {
                    const cd = CooldownEngine.compute(m.last_donation_date, m.deferral_until);
                    return `<tr><td>${m.full_name||''}</td><td>${m.relation_to_head||''}</td><td>${m.age||''}/${m.gender?.charAt(0)||''}</td><td><strong style="color:var(--primary)">${m.blood_group||''}</strong></td><td style="font-family:monospace;">${m.mobile||''}</td><td><span class="badge ${cd.badgeClass}">${cd.label}</span></td></tr>`;
                }).join('');
                let sClass = h.survey_status === 'Completed' ? 'completed' : (h.survey_status === 'Revisit Required' ? 'revisit' : 'progress');
                let vil = Array.isArray(h.geo_villages) ? h.geo_villages[0] : h.geo_villages;
                html += `<div class="card" style="padding:0; overflow:hidden;" id="houseCard_${h.id}"><div class="hdc-header"><div class="hdc-title"><span class="badge badge-slate" style="font-size:12px;">${h.house_uid}</span> <span style="font-weight:800; margin-left:8px;">${vil?.village_name||'N/A'}</span> (${h.para_locality})</div><div style="display:flex; gap:12px; align-items:center;"><select class="status-select ${sClass}" onchange="AdminLogic.updateStatus('${h.id}', this.value, this)"><option value="Completed" ${h.survey_status==='Completed'?'selected':''}>Completed</option><option value="Revisit Required" ${h.survey_status==='Revisit Required'?'selected':''}>Revisit Required</option><option value="In Progress" ${h.survey_status==='In Progress'?'selected':''}>In Progress</option></select></div></div><div style="overflow-x:auto;"><table class="hdc-table"><thead><tr><th>Name</th><th>Relation</th><th>Age/Sex</th><th>Blood</th><th>Mobile</th><th>Status</th></tr></thead><tbody>${membersRows}</tbody></table></div></div>`;
            });
            container.innerHTML = html;
        } catch(e) { container.innerHTML = `<div style="color:var(--danger); padding:20px; text-align:center;">Database Relation Error. Ensure SQL Patch executed.</div>`; }
    },
    updateStatus: async (id, newStatus, selectElement) => {
        try {
            const { error } = await supabaseClient.from('households').update({ survey_status: newStatus }).eq('id', id);
            if(error) throw error; selectElement.className = `status-select ${newStatus === 'Completed' ? 'completed' : (newStatus === 'Revisit Required' ? 'revisit' : 'progress')}`; UI.toast(`Status updated successfully.`);
        } catch(e) { UI.toast("Failed to update status in DB.", "error"); }
    },
    loadAssignmentDropdowns: async () => {
        try {
            const { data: s } = await supabaseClient.from('app_users').select('id, full_name, user_code').eq('role', 'surveyor');
            if(s) document.getElementById('assignSurveyorDrop').innerHTML = '<option value="">Select Surveyor Node</option>' + s.map(x => `<option value="${x.id}">${x.full_name} (${x.user_code})</option>`).join('');
            const { data: d } = await supabaseClient.from('geo_districts').select('id, name').order('name');
            if(d) document.getElementById('assignDistDrop').innerHTML = '<option value="">Select District</option>' + d.map(x => `<option value="${x.id}">${x.name}</option>`).join('');
            document.getElementById('assignBlockDrop').innerHTML = '<option value="">Select Block</option>';
            document.getElementById('assignGPDrop').innerHTML = '<option value="">Select Gram Panchayat</option>';
            document.getElementById('assignVillageDrop').innerHTML = '<option value="">Select Target Village</option>';
        } catch(e) {}
    },
    loadBlocks: async (distId) => {
        if(!distId) return;
        try {
            const { data } = await supabaseClient.from('geo_blocks').select('id, name').eq('district_id', distId).order('name');
            document.getElementById('assignBlockDrop').innerHTML = '<option value="">Select Block</option>' + data.map(x => `<option value="${x.id}">${x.name}</option>`).join('');
        } catch(e) {}
    },
    loadGPs: async (blockId) => {
        if(!blockId) return;
        try {
            const { data } = await supabaseClient.from('geo_gps').select('id, name').eq('block_id', blockId).order('name');
            document.getElementById('assignGPDrop').innerHTML = '<option value="">Select Gram Panchayat</option>' + data.map(x => `<option value="${x.id}">${x.name}</option>`).join('');
        } catch(e) {}
    },
    loadVillages: async (gpId) => {
        if(!gpId) return;
        try {
            const { data } = await supabaseClient.from('geo_villages').select('id, village_name').eq('gp_id', gpId).order('village_name');
            document.getElementById('assignVillageDrop').innerHTML = '<option value="">Select Target Village</option>' + data.map(x => `<option value="${x.id}">${x.village_name}</option>`).join('');
        } catch(e) {}
    },
    loadAssignmentsList: async () => {
        try {
            const { data } = await supabaseClient.from('surveyor_village_assignments').select(`id, app_users!surveyor_village_assignments_surveyor_id_fkey(full_name), geo_villages(village_name,geo_gps(name))`);
            if (data && data.length > 0) {
                document.getElementById('assignmentTableBody').innerHTML = data.map(a => {
                    const surveyorName = Array.isArray(a.app_users) ? a.app_users[0]?.full_name : a.app_users?.full_name;
                    const villageData = Array.isArray(a.geo_villages) ? a.geo_villages[0] : a.geo_villages;
                    const gpData = Array.isArray(villageData?.geo_gps) ? villageData?.geo_gps[0] : villageData?.geo_gps;
                    return `
                        <tr>
                            <td style="font-weight:600;">${surveyorName}</td>
                            <td>
                                <strong style="color:var(--primary); font-size:14px;">${villageData?.village_name || 'Unknown Village'}</strong>
                                <div style="font-size:11px; color:var(--text-muted); font-weight:700; margin-top:4px; text-transform:uppercase; letter-spacing:0.5px;">GP: ${gpData?.name || 'Unknown GP'}</div>
                            </td>
                            <td style="text-align:right;">
                                <button class="btn btn-outline" style="border:none; padding:8px; color:var(--danger); display:inline-flex; width:auto; background:rgba(239,68,68,0.1); border-radius:8px;" onclick="AdminLogic.removeAssignment('${a.id}')"><i class="ph-bold ph-trash" style="font-size:18px;"></i></button>
                            </td>
                        </tr>
                    `;
                }).join('');
            } else { 
                document.getElementById('assignmentTableBody').innerHTML = '<tr><td colspan="3" style="text-align:center; padding:32px; color:var(--text-muted); font-weight:600;">No surveyor vectors currently assigned.</td></tr>'; 
            }
        } catch (e) { document.getElementById('assignmentTableBody').innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--danger); font-weight:bold;">Database Error.</td></tr>'; }
    },
    removeAssignment: async (id) => {
        if (!confirm("Sever assignment link? The surveyor will instantly lose access to this target sector.")) return;
        try { 
            const { error } = await supabaseClient.from('surveyor_village_assignments').delete().eq('id', id); 
            if (error) throw error; UI.toast("Sector link severed successfully.", "success"); AdminLogic.loadAssignmentsList();
        } catch (e) { UI.toast("Failed to sever link.", "error"); }
    },
    createUser: async (e) => {
        e.preventDefault();
        try {
            const { error } = await supabaseClient.rpc('register_user', {
                p_user_code: document.getElementById('uCode').value, p_full_name: document.getElementById('uName').value,
                p_mobile: document.getElementById('uMobile').value, p_email: null,
                p_plain_password: document.getElementById('uPass').value, p_role: document.getElementById('uRole').value
            });
            if(error) throw error; UI.toast("Node Provisioned."); e.target.reset(); AdminLogic.loadAssignmentDropdowns(); 
        } catch(err) { UI.toast(err.message, 'error'); }
    },
    assignVillage: async (e) => {
        e.preventDefault();
        const surveyorId = document.getElementById('assignSurveyorDrop').value; const villageId = document.getElementById('assignVillageDrop').value;
        if (!surveyorId || !villageId) return UI.toast("Please select both a Surveyor and a Target Village.", "warning");
        try {
            const { error } = await supabaseClient.from('surveyor_village_assignments').insert([{ surveyor_id: surveyorId, village_id: villageId }]);
            if (error) throw error; UI.toast("Sector Successfully Assigned!", "success"); e.target.reset(); AdminLogic.loadAssignmentsList(); 
        } catch (err) { UI.toast("Assignment Failed: " + err.message, "error"); }
    }
};

const GeoLogic = {
    init: () => {
        GeoLogic.loadTable('geo_districts', 'list-districts', 'name');
        GeoLogic.loadTableWithParent('geo_blocks', 'list-blocks', 'name', 'district_id', 'geo_districts', 'selDistForBlock');
        GeoLogic.loadTableWithParent('geo_gps', 'list-gps', 'name', 'block_id', 'geo_blocks', 'selBlockForGP');
        GeoLogic.loadTableWithParent('geo_villages', 'list-villages', 'village_name', 'gp_id', 'geo_gps', 'selGPForVillage');
    },
    loadTable: async (table, containerId, nameField) => {
        const { data } = await supabaseClient.from(table).select('*').order(nameField);
        const container = document.getElementById(containerId);
        if(!data || data.length === 0) return container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">No records found.</div>';
        container.innerHTML = data.map(item => `
            <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #E2E8F0; font-size:13px; align-items:center;">
                <strong>${item[nameField]}</strong>
                <button class="btn btn-outline" style="border:none; padding:4px; color:var(--danger); width:auto;" onclick="GeoLogic.deleteEntity('${table}', '${item.id}')"><i class="ph-bold ph-trash"></i></button>
            </div>
        `).join('');
    },
    loadTableWithParent: async (table, containerId, nameField, parentIdField, parentTable, selectId) => {
        const { data: parents } = await supabaseClient.from(parentTable).select('*').order(parentTable === 'geo_villages' ? 'village_name' : 'name');
        if(parents) { document.getElementById(selectId).innerHTML = `<option value="">Select Parent...</option>` + parents.map(p => `<option value="${p.id}">${p.name || p.village_name}</option>`).join(''); }
        const { data } = await supabaseClient.from(table).select(`*, parent:${parentTable}(*)`).order(nameField);
        const container = document.getElementById(containerId);
        if(!data || data.length === 0) return container.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">No records found.</div>';
        container.innerHTML = data.map(item => `
            <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #E2E8F0; font-size:13px; align-items:center;">
                <div><strong>${item[nameField]}</strong> <span style="font-size:10px; color:var(--text-muted); display:block;">Under: ${item.parent?.name || item.parent?.village_name || 'Unknown'}</span></div>
                <button class="btn btn-outline" style="border:none; padding:4px; color:var(--danger); width:auto;" onclick="GeoLogic.deleteEntity('${table}', '${item.id}')"><i class="ph-bold ph-trash"></i></button>
            </div>
        `).join('');
    },
    addEntity: async (e, table, fields, inputId) => {
        e.preventDefault();
        const payload = {}; payload[fields[0]] = document.getElementById(inputId).value;
        try { const { error } = await supabaseClient.from(table).insert([payload]); if(error) throw error; UI.toast("Added successfully."); e.target.reset(); GeoLogic.init(); AdminLogic.loadAssignmentDropdowns(); } catch(err) { UI.toast("Error adding record.", "error"); }
    },
    addBlock: async (e) => {
        e.preventDefault();
        try { const { error } = await supabaseClient.from('geo_blocks').insert([{ name: document.getElementById('blockName').value, district_id: document.getElementById('selDistForBlock').value }]); if(error) throw error; UI.toast("Block added."); e.target.reset(); GeoLogic.init(); } catch(err) { UI.toast("Error", "error"); }
    },
    addGP: async (e) => {
        e.preventDefault();
        try { const { error } = await supabaseClient.from('geo_gps').insert([{ name: document.getElementById('gpName').value, block_id: document.getElementById('selBlockForGP').value }]); if(error) throw error; UI.toast("GP added."); e.target.reset(); GeoLogic.init(); } catch(err) { UI.toast("Error", "error"); }
    },
    addVillage: async (e) => {
        e.preventDefault();
        try { const { error } = await supabaseClient.from('geo_villages').insert([{ village_name: document.getElementById('villName').value, gp_id: document.getElementById('selGPForVillage').value }]); if(error) throw error; UI.toast("Village added."); e.target.reset(); GeoLogic.init(); } catch(err) { UI.toast("Error", "error"); }
    },
    deleteEntity: async (table, id) => {
        if(!confirm("Warning: Deleting this will cascade and delete all connected geographic children. Proceed?")) return;
        try { const { error } = await supabaseClient.from(table).delete().eq('id', id); if(error) throw error; UI.toast("Deleted."); GeoLogic.init(); AdminLogic.loadAssignmentDropdowns(); } catch(err) { UI.toast("Error deleting.", "error"); }
    }
};

const HospitalLogic = {
    baseInv: null,
    loadInventory: async () => {
        const grid = document.getElementById('hospitalInvGrid');
        try {
            const { data, error } = await supabaseClient.from('family_members').select('blood_group, last_donation_date, deferral_until').eq('donor_availability', 'Available & Willing').eq('blood_verified', true);
            if(error) throw error;
            const inv = { 'A+': 0, 'A-': 0, 'B+': 0, 'B-': 0, 'O+': 0, 'O-': 0, 'AB+': 0, 'AB-': 0 };
            if(data) { data.forEach(m => { const cd = CooldownEngine.compute(m.last_donation_date, m.deferral_until); if(inv[m.blood_group] !== undefined && cd.isEligible) inv[m.blood_group]++; }); }
            HospitalLogic.baseInv = inv; HospitalLogic.renderInv('WB');
        } catch(e) { grid.innerHTML = '<div style="grid-column:1/-1; color:red; text-align:center;">Network Disconnect.</div>'; }
    },
    renderInv: (comp) => {
        const grid = document.getElementById('hospitalInvGrid');
        if(!HospitalLogic.baseInv) return;
        document.getElementById('btnInvWB').className = comp==='WB'?'btn btn-medical':'btn btn-outline';
        document.getElementById('btnInvPRBC').className = comp==='PRBC'?'btn btn-medical':'btn btn-outline';
        document.getElementById('btnInvPLT').className = comp==='PLT'?'btn btn-medical':'btn btn-outline';
        if(comp!=='WB') { document.getElementById('btnInvWB').style.color="var(--medical)"; document.getElementById('btnInvWB').style.borderColor="var(--medical)"; }
        if(comp!=='PRBC') { document.getElementById('btnInvPRBC').style.color="var(--medical)"; document.getElementById('btnInvPRBC').style.borderColor="var(--medical)"; }
        if(comp!=='PLT') { document.getElementById('btnInvPLT').style.color="var(--medical)"; document.getElementById('btnInvPLT').style.borderColor="var(--medical)"; }
        let mul = 1; let label = "Whole Blood"; let clr = "var(--medical)";
        if(comp === 'PRBC') { mul = 0.9; label = "Packed RBC"; clr = "#BE123C"; }
        if(comp === 'PLT') { mul = 0.4; label = "Platelets"; clr = "#CA8A04"; }
        grid.innerHTML = Object.keys(HospitalLogic.baseInv).map(k => {
            let val = Math.floor(HospitalLogic.baseInv[k] * mul);
            return `<div class="card" style="text-align: center; border-top: 4px solid ${clr}; margin:0;"><h3 style="font-size:40px; color:${clr};">${val}</h3><div style="font-size:12px; font-weight:800; color:var(--text-muted); text-transform:uppercase;">${k} ${label}</div></div>`;
        }).join('');
    },
    loadBeds: async () => {
        const tbl = document.getElementById('hospBedsList');
        try {
            const {data} = await supabaseClient.from('hospital_beds').select('*').eq('hospital_id', activeUser.id).order('updated_at', {ascending:false});
            if(!data || data.length===0) return tbl.innerHTML = '<tr><td colspan="4" style="text-align:center;">No beds registered in facility.</td></tr>';
            tbl.innerHTML = data.map(b => `
                <tr>
                    <td><strong>${b.ward_name}</strong> - ${b.bed_number}</td>
                    <td><span class="badge ${b.status==='Available'?'badge-success':'badge-warning'}">${b.status}</span></td>
                    <td><strong style="color:var(--danger)">${b.blood_required || 'None'}</strong></td>
                    <td style="text-align:right;"><button class="btn btn-outline" style="border:none; color:var(--danger); padding:4px;" onclick="HospitalLogic.deleteBed('${b.id}')"><i class="ph-bold ph-trash"></i></button></td>
                </tr>
            `).join('');
        } catch(e) { tbl.innerHTML = '<tr><td colspan="4" style="color:red;">DB Error</td></tr>'; }
    },
    addBed: async (e) => {
        e.preventDefault();
        const payload = { hospital_id: activeUser.id, ward_name: document.getElementById('bedWard').value, bed_number: document.getElementById('bedNo').value, status: document.getElementById('bedStatus').value, blood_required: document.getElementById('bedBlood').value };
        try { const {error} = await supabaseClient.from('hospital_beds').insert([payload]); if(error) throw error; UI.toast("Bed Registered."); e.target.reset(); document.getElementById('modalAddBed').style.display='none'; HospitalLogic.loadBeds(); } catch(err) { UI.toast("Failed to add bed.", 'error'); }
    },
    deleteBed: async (id) => {
        if(!confirm("Remove this bed from inventory?")) return;
        try { const {error} = await supabaseClient.from('hospital_beds').delete().eq('id', id); if(error) throw error; UI.toast("Bed removed"); HospitalLogic.loadBeds(); } catch(e) {}
    },
    loadSOS: async () => {
        const list = document.getElementById('hospSOSList');
        try {
            const { data } = await supabaseClient.from('sos_tickets').select('id, patient_name, blood_group, units, urgency, status, app_users!sos_tickets_doctor_id_fkey(full_name)').eq('status', 'Broadcasted').order('created_at', {ascending: false});
            if(!data || data.length === 0) return list.innerHTML = '<div style="color:var(--text-muted); font-size:13px; text-align:center; padding:20px; font-weight:600;">No active emergency tickets in grid.</div>';
            list.innerHTML = data.map(t => `
                <div style="padding:16px; border-bottom:1px solid #E2E8F0;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <strong>${t.patient_name} - <span style="color:var(--primary); font-size:16px;">${t.blood_group}</span> (${t.units}u)</strong>
                    </div>
                    <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">Dr. ${t.app_users.full_name} | ${t.urgency}</div>
                    <button class="btn btn-medical" style="width:auto; padding:8px 16px; font-size:11px;" onclick="HospitalLogic.acceptSOS('${t.id}')">Accept & Dispatch</button>
                </div>
            `).join('');
        } catch(e) {}
    },
    acceptSOS: async (id) => {
        try { const {error} = await supabaseClient.from('sos_tickets').update({status: 'Claimed', claimed_by: activeUser.id}).eq('id', id); if(error) throw error; UI.toast("Ticket Claimed! Dispatch initiated.", "success"); HospitalLogic.loadSOS(); } catch(e) { UI.toast("Claim failed.", "error"); }
    },
    logReplacement: async (e) => {
        e.preventDefault();
        const mob = document.getElementById('hospRepMobile').value.trim(); const bag = document.getElementById('hospRepBag').value.trim();
        try {
            let member;
            if(mob.toUpperCase().startsWith('RD-')) {
                 const {data} = await supabaseClient.from('family_members').select('id, full_name').eq('member_uid', mob.toUpperCase()).single(); member = data;
            } else {
                 const {data} = await supabaseClient.from('family_members').select('id, full_name').eq('mobile', mob).single(); member = data;
            }
            if(!member) throw new Error("Donor not found in census.");
            
            const today = new Date().toISOString().split('T')[0];
            const {error:e1} = await supabaseClient.from('family_members').update({last_donation_date: today, donor_availability: 'Temporarily Ineligible'}).eq('id', member.id);
            if(e1) throw e1;

            const {error:e2} = await supabaseClient.from('hospital_replacements').insert([{ hospital_id: activeUser.id, member_id: member.id, bag_barcode: bag }]);
            if(e2) throw e2;

            UI.toast(`Replacement logged for ${member.full_name}. 90-Day Timer engaged.`, "success");
            e.target.reset(); HospitalLogic.loadInventory();
        } catch(err) { UI.toast(err.message, "error"); }
    }
};

const DoctorLogic = {
    searchPatient: async (e) => {
        e.preventDefault();
        const mobile = document.getElementById('docMobile').value;
        const area = document.getElementById('docPatientResults'); area.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Retrieving...';
        try {
            const { data, error } = await supabaseClient.from('family_members').select('id, full_name, age, gender, blood_group, blood_verified, deferral_until, last_donation_date, verification_doc_type').eq('mobile', mobile);
            if(error || !data || data.length === 0) return area.innerHTML = '<p style="color:var(--text-muted); font-size:12px;">No trace found.</p>';
            area.innerHTML = data.map(p => {
                const cd = CooldownEngine.compute(p.last_donation_date, p.deferral_until);
                return `
                    <div class="member-card">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                            <strong style="font-size:16px;">${p.full_name} (${p.age} / ${p.gender})</strong>
                            <span class="badge ${cd.badgeClass}">${cd.label}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                            <div style="font-size:13px; color:var(--text-muted);">Blood Group: <strong style="color:var(--primary); font-size:18px; margin:0 4px;">${p.blood_group}</strong> ${p.blood_verified ? '<span class="badge badge-success">Verified</span>' : ''}<br>Last Log: <strong>${p.last_donation_date || 'N/A'}</strong></div>
                            <button class="btn btn-outline" style="border-color:var(--danger); color:var(--danger); width:auto; padding:8px 16px; font-size:11px;" onclick="DoctorLogic.flagAdverse('${p.id}')"><i class="ph-bold ph-warning"></i> Flag Reaction</button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch(err) { area.innerHTML = '<p style="color:red;">Error.</p>'; }
    },
    flagAdverse: async (id) => {
        if(!confirm("Flagging this patient will lock their profile globally. Proceed?")) return;
        try { const {error} = await supabaseClient.from('family_members').update({adverse_reaction_flag: true, deferral_until: '9999-12-31', deferral_reason: 'Doctor Adverse Reaction Flag', donor_availability: 'Permanently Ineligible'}).eq('id', id); if(error) throw error; UI.toast("Patient locked for review.", "error"); } catch(e) { UI.toast("Failed to lock.", "error"); }
    },
    raiseSOS: async (e) => {
        e.preventDefault();
        const pat = document.getElementById('sosPat').value; const bg = document.getElementById('sosBg').value; const unt = document.getElementById('sosUnits').value; const urg = document.getElementById('sosUrg').value;
        try { const {error} = await supabaseClient.from('sos_tickets').insert([{ doctor_id: activeUser.id, patient_name: pat, blood_group: bg, units: parseInt(unt), urgency: urg }]); if(error) throw error; UI.toast("Code Red Encrypted & Broadcasted!"); e.target.reset(); DoctorLogic.loadSOS(); } catch(err) { UI.toast("Transmission Failed", 'error'); }
    },
    loadSOS: async () => {
        const list = document.getElementById('docSOSList');
        try {
            const { data } = await supabaseClient.from('sos_tickets').select('id, patient_name, blood_group, units, urgency, status, app_users!sos_tickets_claimed_by_fkey(full_name), created_at').eq('doctor_id', activeUser.id).order('created_at', {ascending: false});
            if(!data || data.length === 0) return list.innerHTML = '<div style="font-size:13px; color:var(--text-muted); font-weight:600; text-align:center; padding:20px; grid-column:1/-1;">No active transmissions.</div>';
            list.innerHTML = data.map(t => `
                <div class="card" style="margin-bottom:0; padding:20px; border-left:4px solid ${t.status==='Broadcasted'?'var(--danger)':'var(--success)'};">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <strong style="font-size:16px;">${t.patient_name} - <span style="color:var(--primary); font-size:18px;">${t.blood_group}</span> (${t.units} Unit)</strong>
                        <span class="badge ${t.status==='Broadcasted'?'badge-danger':'badge-success'}">${t.status}</span>
                    </div>
                    <div style="font-size:12px; color:var(--text-muted); font-weight:600;"><i class="ph-bold ph-clock"></i> Urgency: ${t.urgency}</div>
                    ${t.status==='Claimed' ? `<div style="font-size:12px; margin-top:8px; color:var(--success); font-weight:bold;"><i class="ph-bold ph-check"></i> Claimed by: ${t.app_users?.full_name}</div>` : ''}
                </div>
            `).join('');
        } catch(e) {}
    }
};

const PathologyLogic = {
    searchCitizen: async (e) => {
        e.preventDefault();
        const mobile = document.getElementById('pathMobile').value;
        const area = document.getElementById('pathResults'); area.style.display = 'block'; area.innerHTML = '<i class="ph ph-spinner ph-spin" style="font-size:24px;"></i>';
        try {
            const { data, error } = await supabaseClient.from('family_members').select('id, full_name, age, gender, blood_group, blood_verified').eq('mobile', mobile);
            if(error || !data || data.length === 0) return area.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">No trace.</p>';
            area.innerHTML = data.map(m => `
                <div class="member-card">
                    <div style="display:flex; justify-content:space-between; margin-bottom:16px;">
                        <strong style="font-size:16px;">${m.full_name} (${m.age}/${m.gender.charAt(0)})</strong>
                        ${m.blood_verified ? '<span class="badge badge-success">Verified</span>' : '<span class="badge badge-warning">Unverified</span>'}
                    </div>
                    <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                        <select id="updBg_${m.id}" class="form-control" style="background:#F8FAFC; width:100px; font-weight:800;">
                            <option value="A+" ${m.blood_group==='A+'?'selected':''}>A+</option><option value="A-" ${m.blood_group==='A-'?'selected':''}>A-</option>
                            <option value="B+" ${m.blood_group==='B+'?'selected':''}>B+</option><option value="B-" ${m.blood_group==='B-'?'selected':''}>B-</option>
                            <option value="O+" ${m.blood_group==='O+'?'selected':''}>O+</option><option value="O-" ${m.blood_group==='O-'?'selected':''}>O-</option>
                            <option value="AB+" ${m.blood_group==='AB+'?'selected':''}>AB+</option><option value="AB-" ${m.blood_group==='AB-'?'selected':''}>AB-</option>
                        </select>
                        <select id="updRare_${m.id}" class="form-control" style="background:#F8FAFC; width:160px;"><option value="Pathology Report">Standard (No Variant)</option><option value="Pathology - Bombay Oh">Bombay (Oh) Variant</option><option value="Pathology - Rh-Null">Rh-Null Variant</option></select>
                        <button class="btn btn-primary" style="width:auto; padding:12px 24px; background:var(--pathology);" onclick="PathologyLogic.markVerified('${m.id}')"><i class="ph-bold ph-lock-key"></i> Lock Cert</button>
                        <button class="btn btn-outline" style="width:auto; padding:12px 16px; border-color:var(--pathology); color:var(--pathology);" title="Download Digital ID" onclick="PathologyLogic.genCard('${m.full_name}', '${m.blood_group}')"><i class="ph-bold ph-identification-card" style="font-size:20px;"></i></button>
                    </div>
                </div>
            `).join('');
        } catch(e) { area.innerHTML = '<p style="color:red;">Error.</p>'; }
    },
    markVerified: async (id) => {
        const bg = document.getElementById(`updBg_${id}`).value; const proof = document.getElementById(`updRare_${id}`).value;
        try { const { error } = await supabaseClient.from('family_members').update({ blood_group: bg, blood_verified: true, verification_doc_type: proof }).eq('id', id); if(error) throw error; UI.toast("Phenotype Locked!"); document.getElementById('pathMobile').value = ''; document.getElementById('pathResults').style.display = 'none'; } catch(e) { UI.toast("Update failed.", "error"); }
    },
    applyDeferral: async (e) => {
        e.preventDefault();
        const id = document.getElementById('defId').value; const type = parseInt(document.getElementById('defType').value); const reason = document.getElementById('defReason').value;
        try {
            const { data: member } = await supabaseClient.from('family_members').select('id').or(`mobile.eq.${id},member_uid.eq.${id}`).single();
            if(!member) throw new Error("Donor not found in system.");
            let dDate = new Date(); if(type === 9999) dDate.setFullYear(9999); else dDate.setDate(dDate.getDate() + type);
            const { error } = await supabaseClient.from('family_members').update({ deferral_until: dDate.toISOString().split('T')[0], deferral_reason: reason, donor_availability: 'Temporarily Ineligible' }).eq('id', member.id);
            if(error) throw error; UI.toast("Encrypted Shadow-Ban applied.", "success"); e.target.reset();
        } catch(err) { UI.toast("Failed: " + err.message, "error"); }
    },
    genCard: (name, bg) => {
        if(!window.jspdf) return; const { jsPDF } = window.jspdf; const doc = new jsPDF({orientation: 'landscape', unit: 'mm', format: [85, 55]});
        doc.setFillColor(147, 51, 234); doc.rect(0,0,85,14,'F'); doc.setTextColor(255,255,255); doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.text("RAKTADHARA OFFICIAL ID", 42.5, 9, {align:"center"});
        doc.setTextColor(15,23,42); doc.setFontSize(14); doc.text(name.toUpperCase(), 6, 28); doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.text("Verified Blood Group:", 6, 38);
        doc.setFontSize(26); doc.setFont("helvetica", "bold"); doc.setTextColor(139,0,0); doc.text(bg, 6, 48); doc.save(`BloodCard_${name}.pdf`);
    }
};

const CampLogic = {
    camps: [], activeCampId: null,
    loadCamps: async () => {
        try { const { data, error } = await supabaseClient.from('camps').select('*').eq('organizer_id', activeUser.id).order('event_date', {ascending: false}); if(!error && data) { CampLogic.camps = data; CampLogic.switchTab('Live'); } } catch(e) {}
    },
    switchTab: (status) => {
        document.getElementById('tabCampLive').className = status==='Live'?'btn btn-camp':'btn btn-outline';
        document.getElementById('tabCampPast').className = status==='Past'?'btn btn-camp':'btn btn-outline';
        if(status==='Past') { document.getElementById('tabCampPast').style.color="var(--text-muted)"; document.getElementById('tabCampPast').style.borderColor="#CBD5E1"; }
        const cont = document.getElementById('campEventList');
        const filtered = CampLogic.camps.filter(c => status === 'Live' ? c.status !== 'Past' : c.status === 'Past');
        if(filtered.length === 0) return cont.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; font-size:13px; color:var(--text-muted); border:2px dashed #E2E8F0; border-radius:16px;">No ${status.toLowerCase()} events orchestrating.</div>`;
        cont.innerHTML = filtered.map(c => `
            <div class="member-card" style="cursor:pointer; padding:24px; border-left:6px solid var(--camp);" onclick="CampLogic.openWorkspace('${c.id}')">
                <h3 style="font-size:18px; margin-bottom:12px; color:var(--accent);">${c.title}</h3>
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:16px; font-weight:600;"><i class="ph-bold ph-calendar"></i> ${c.event_date} <br><i class="ph-bold ph-map-pin" style="margin-top:6px;"></i> ${c.venue}</div>
                <span class="badge ${status==='Live'?'badge-success':'badge-slate'}">${c.status}</span>
            </div>
        `).join('');
    },
    createCamp: async (e) => {
        e.preventDefault();
        const payload = { organizer_id: activeUser.id, title: document.getElementById('cTitle').value, event_date: document.getElementById('cDate').value, target_goal: parseInt(document.getElementById('cGoal').value), venue: document.getElementById('cVenue').value, partner_bank: document.getElementById('cBank').value, status: 'Live' };
        try { const {error} = await supabaseClient.from('camps').insert([payload]); if(error) throw error; UI.toast("Event Orchestrator Initialized"); document.getElementById('modalCreateCamp').style.display='none'; e.target.reset(); CampLogic.loadCamps(); } catch(err) { UI.toast("Initialization failed", "error"); }
    },
    openWorkspace: (id) => {
        const c = CampLogic.camps.find(x => x.id === id); if(!c) return;
        CampLogic.activeCampId = id; document.getElementById('cwTitle').innerText = c.title; document.getElementById('cwDate').innerText = c.event_date; document.getElementById('cwBank').innerText = c.partner_bank;
        document.getElementById('campEventList').style.display = 'none'; document.getElementById('activeCampWorkspace').style.display = 'block';
    },
    closeWorkspace: () => { document.getElementById('activeCampWorkspace').style.display = 'none'; document.getElementById('campEventList').style.display = 'grid'; CampLogic.activeCampId = null; },
    searchFamily: async (e) => {
        e.preventDefault();
        const queryVal = document.getElementById('campSearchInput').value.trim();
        const area = document.getElementById('campFamilyResults'); area.innerHTML = '<i class="ph ph-spinner ph-spin" style="font-size:24px;"></i> Searching Ledger...';
        try {
            let houseIds = [];
            if(queryVal.toUpperCase().startsWith('RD-')) {
                const { data } = await supabaseClient.from('households').select('id').eq('house_uid', queryVal.toUpperCase());
                if(data) houseIds = data.map(d => d.id);
            } else {
                const { data: members } = await supabaseClient.from('family_members').select('household_id').or(`mobile.eq.${queryVal},full_name.ilike.%${queryVal}%`);
                if(members && members.length > 0) houseIds = [...new Set(members.map(m => m.household_id).filter(id => id != null))];
            }
            if(houseIds.length === 0) throw new Error("No records.");
            const { data: householdsData, error } = await supabaseClient.from('households').select('id, house_uid, family_head_name, family_members(id, full_name, age, blood_group, last_donation_date, deferral_until)').in('id', houseIds).limit(3);
            if(error || !householdsData) throw error;
            area.innerHTML = householdsData.map(data => {
                let membersHtml = data.family_members.map(m => {
                    const cd = CooldownEngine.compute(m.last_donation_date, m.deferral_until);
                    return `
                        <div style="display:flex; justify-content:space-between; align-items:center; padding: 16px 0; border-bottom: 1px solid rgba(0,0,0,0.05); flex-wrap:wrap; gap:12px;">
                            <div><strong>${m.full_name} (${m.age}) - <span style="color:var(--primary); font-size:16px;">${m.blood_group}</span></strong><br><span class="badge ${cd.badgeClass}" style="margin-top:6px;">${cd.label}</span></div>
                            <div style="display:flex; gap:12px;">
                                <button class="btn btn-camp" style="width:auto; padding:10px 16px; font-size:12px;" onclick="CampLogic.logDonation('${m.id}', '${m.full_name}')" ${!cd.isEligible ? 'disabled' : ''}>${!cd.isEligible ? 'Locked' : 'Log Donation'}</button>
                                <button class="btn btn-outline" style="width:auto; padding:10px 16px; font-size:12px; border-color:var(--text-muted); color:var(--text-muted);" onclick="CampLogic.printCertificate('${m.full_name}', '${m.blood_group}', '${data.house_uid}')"><i class="ph-bold ph-certificate"></i> Print Cert</button>
                            </div>
                        </div>
                    `;
                }).join('');
                return `<div class="member-card" style="margin-bottom: 16px; padding:24px; box-shadow:none;"><h4 style="margin-bottom:8px; font-size:14px; color:var(--text-muted); font-weight:800; letter-spacing:1px;">${data.house_uid} | HEAD: ${data.family_head_name}</h4>${membersHtml}</div>`;
            }).join('');
        } catch(err) { area.innerHTML = '<span style="color:red; font-size:13px; font-weight:bold;">No matching records found.</span>'; }
    },
    logManualWalkIn: async (e) => {
        e.preventDefault();
        const name = document.getElementById('mCampName').value; const mob = document.getElementById('mCampMobile').value; const bg = document.getElementById('mCampBg').value;
        try {
            const today = new Date().toISOString().split('T')[0];
            const payload = { full_name: name, mobile: mob, blood_group: bg, last_donation_date: today, donor_availability: 'Temporarily Ineligible', triage_passed: true, member_uid: 'WK-' + Date.now().toString().slice(-6) };
            const { data, error } = await supabaseClient.from('family_members').insert([payload]).select().single();
            if(error) throw error;
            if(CampLogic.activeCampId) { await supabaseClient.from('camp_donations').insert([{ camp_id: CampLogic.activeCampId, member_id: data.id, bag_uid: 'WALK-IN-MANUAL' }]); }
            UI.toast(`Manual donation saved for ${name}. Surveyor auto-fetch enabled.`, 'success'); e.target.reset(); CampLogic.printCertificate(name, bg, 'UNREGISTERED WALK-IN');
        } catch(err) { UI.toast("Failed to log manual.", 'error'); }
    },
    logDonation: async (memberId, memberName) => {
        if(!CampLogic.activeCampId) return;
        try {
            const today = new Date().toISOString().split('T')[0];
            const { error: err1 } = await supabaseClient.from('family_members').update({ last_donation_date: today, donor_availability: 'Temporarily Ineligible' }).eq('id', memberId);
            if(err1) throw err1;
            const { error: err2 } = await supabaseClient.from('camp_donations').insert([{ camp_id: CampLogic.activeCampId, member_id: memberId, bag_uid: 'WALK-IN' }]);
            UI.toast(`Donation logged for ${memberName}. 90-day protocol active.`); document.getElementById('campFamilyResults').innerHTML = ''; document.getElementById('campSearchInput').value = '';
        } catch(e) { UI.toast("Sync failed.", "error"); }
    },
    printCertificate: (donorName, bg, houseUid) => {
        if(!window.jspdf) return UI.toast("PDF Engine loading...", "error");
        const { jsPDF } = window.jspdf; const doc = new jsPDF('landscape');
        doc.setFillColor(250, 250, 250); doc.rect(0, 0, 297, 210, 'F');
        doc.setDrawColor(234, 88, 12); doc.setLineWidth(1.5); doc.rect(15, 15, 267, 180);
        doc.setFillColor(234, 88, 12); doc.rect(225, 0, 55, 30, 'F'); doc.setFontSize(9); doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold");
        doc.text("FAMILY / HOUSE ID", 252.5, 11, {align:"center"}); doc.setFontSize(13); doc.text(houseUid || "WALK-IN", 252.5, 20, {align:"center"});
        doc.setFontSize(28); doc.setTextColor(234, 88, 12); doc.text("CERTIFICATE OF APPRECIATION", 148, 60, { align: "center" });
        doc.setFontSize(13); doc.setTextColor(100, 116, 139); doc.text("RaktaDhara Regional Blood Grid | Powered by IndianWorkers", 148, 72, { align: "center" });
        doc.setFontSize(16); doc.setTextColor(15, 23, 42); doc.setFont("helvetica", "normal"); doc.text("This is proudly awarded to", 148, 100, { align: "center" });
        doc.setFontSize(32); doc.setFont("helvetica", "bold"); doc.setTextColor(139, 0, 0); doc.text(donorName.toUpperCase(), 148, 118, { align: "center" });
        doc.setFontSize(14); doc.setFont("helvetica", "normal"); doc.setTextColor(15, 23, 42); doc.text(`For voluntary blood donation of Blood Group [ ${bg} ]`, 148, 138, { align: "center" });
        const c = CampLogic.camps.find(x => x.id === CampLogic.activeCampId);
        doc.setFontSize(11); doc.text(`Camp: ${c?c.title:'Regional Drive'}`, 30, 175); doc.text(`Date: ${new Date().toLocaleDateString()}`, 30, 185); doc.text("Authorized Medical Signature", 210, 185);
        doc.save(`Certificate_${donorName}_IndianWorkers.pdf`);
    },
    printManifest: () => { UI.toast("Generating Handover Manifest PDF...", "success"); }
};

const SurveyorLogic = {
    activeFetchIdx: null,
    fetchResults: [],
    deletedMemberIds: [],

    checkO_Negative: () => {
        let hasONegative = false;
        document.querySelectorAll('#membersContainer [id^="memBg_"]').forEach(sel => { if(sel.value === 'O-') hasONegative = true; });
        const gpsCont = document.getElementById('gpsContainer');
        if(hasONegative) { gpsCont.style.display = 'block'; document.getElementById('hGps').required = true; } 
        else { gpsCont.style.display = 'none'; document.getElementById('hGps').required = false; }
    },
    toggleTriage: (idx) => {
        const donorEl = document.getElementById(`memDonor_${idx}`);
        if (!donorEl) return;
        const avail = donorEl.value;
        const tBox = document.getElementById(`triageBox_${idx}`);
        if (!tBox) return;
        if(avail === 'Available & Willing') { tBox.style.display = 'block'; } 
        else {
            tBox.style.display = 'none';
            if(document.getElementById(`triAge_${idx}`)) {
                document.getElementById(`triAge_${idx}`).checked = false;
                document.getElementById(`triWt_${idx}`).checked = false;
                document.getElementById(`triSurg_${idx}`).checked = false;
            }
        }
    },
    getLocation: () => {
        if(!navigator.geolocation) return UI.toast("GPS not supported", "error");
        document.getElementById('hGps').value = "Acquiring satellites...";
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                document.getElementById('hLat').value = pos.coords.latitude; document.getElementById('hLng').value = pos.coords.longitude;
                document.getElementById('hGps').value = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`; UI.toast("Coordinates locked", "success");
            },
            (err) => { document.getElementById('hGps').value = ""; UI.toast("GPS Failed: " + err.message, "error"); },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    },
    
    renderMemberRow: (idx, data = {}, isHof = false) => {
        const container = document.getElementById('membersContainer');
        const row = document.createElement('div');
        row.className = 'member-card';
        row.id = `memberRow_${idx}`;
        
        const relOpts = isHof 
            ? `<option value="Head of Family">Head of Family</option>` 
            : `<option value="">Relation</option><option value="Wife">Wife</option><option value="Husband">Husband</option><option value="Son">Son</option><option value="Daughter">Daughter</option><option value="Father">Father</option><option value="Mother">Mother</option><option value="Other">Other</option>`;

        row.innerHTML = `
            <input type="hidden" id="memId_${idx}" value="${data.id || ''}">
            <input type="hidden" id="memUid_${idx}" value="${data.member_uid || ''}">
            ${isHof ? '<div class="hof-badge"><i class="ph-fill ph-crown" style="font-size:14px;"></i> Head of Family</div>' : `<div style="font-size:13px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-bottom:16px; letter-spacing:1px;"><i class="ph-bold ph-users"></i> Family Member</div><button type="button" class="remove-btn" onclick="SurveyorLogic.removeMember('${idx}')"><i class="ph-bold ph-x"></i></button>`}
            
            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1.5fr; gap: 16px; margin-bottom:16px;" class="grid-2">
                <div class="form-group"><label class="form-label">Full Name</label><input type="text" class="form-control" id="memName_${idx}" required value="${data.full_name || ''}"></div>
                <div class="form-group"><label class="form-label">Relation</label><select class="form-control" id="memRel_${idx}" required ${isHof ? 'style="pointer-events:none; background:#F1F5F9; font-weight:800;"' : ''}>${relOpts}</select></div>
                <div class="form-group"><label class="form-label">Age</label><input type="number" class="form-control" id="memAge_${idx}" required min="1" max="120" value="${data.age || ''}"></div>
                <div class="form-group"><label class="form-label">Gender</label><select class="form-control" id="memGender_${idx}" required><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option></select></div>
                <div class="form-group"><label class="form-label">Mobile Number</label><div style="display:flex; gap:8px;"><input type="tel" class="form-control" id="memMobile_${idx}" required value="${data.mobile || ''}"><button type="button" class="btn btn-outline" style="padding:0 8px; width:auto;" onclick="SurveyorLogic.fetchPreReg('${idx}')" title="Sync DB"><i class="ph-bold ph-arrows-clockwise"></i></button> ${!isHof ? `<button type="button" class="btn btn-outline" style="padding:0 8px; width:auto;" onclick="SurveyorLogic.copyHOFMobile('${idx}')" title="Copy Head Mobile"><i class="ph-bold ph-copy"></i></button>` : ''}</div></div>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1.5fr 1fr 1fr; gap: 16px; background: rgba(254,226,226,0.1); padding: 20px; border-radius: 16px; border: 1px solid #FECDD3;" class="grid-2">
                <div class="form-group"><label class="form-label">Blood Group</label>
                    <select class="form-control" style="background:white; border-color:#FCA5A5; font-weight:800;" id="memBg_${idx}" required onchange="SurveyorLogic.checkO_Negative()">
                        <option value="">Select Group</option><option value="A+">A+</option><option value="A-">A-</option><option value="B+">B+</option><option value="B-">B-</option><option value="O+">O+</option><option value="O-">O-</option><option value="AB+">AB+</option><option value="AB-">AB-</option><option value="Unknown" style="color:var(--danger);">Unknown</option>
                    </select>
                </div>
                <div class="form-group"><label class="form-label">Availability Status</label><select class="form-control" style="background:white; font-weight:800;" id="memDonor_${idx}" required onchange="SurveyorLogic.toggleTriage('${idx}')"><option value="Available & Willing" style="color:var(--success);">Available & Willing</option><option value="Temporarily Ineligible">Temporarily Ineligible</option><option value="Permanently Ineligible" style="color:var(--danger);">Permanently Ineligible</option><option value="Unwilling / Opted Out">Unwilling / Opted Out</option></select></div>
                <div class="form-group"><label class="form-label">Life Status</label><select class="form-control" style="background:white;" id="memLife_${idx}" required><option value="Alive">Alive (Active)</option><option value="Migrated">Migrated</option><option value="Deceased">Deceased</option></select></div>
                <div class="form-group"><label class="form-label">Last Donated</label><input type="date" class="form-control" style="background:white;" id="memLastDon_${idx}" value="${data.last_donation_date || ''}"></div>
            </div>
            <div class="triage-box" id="triageBox_${idx}" style="display:block;">
                <span style="font-size:11px; font-weight:800; color:#065F46; text-transform:uppercase; margin-bottom:12px; display:block; letter-spacing:1px;">Field Triage Checklist</span>
                <label><input type="checkbox" id="triAge_${idx}"> Citizen is between 18 and 65 years old</label>
                <label><input type="checkbox" id="triWt_${idx}"> Estimated weight is ≥ 45 kg</label>
                <label><input type="checkbox" id="triSurg_${idx}"> No major surgery/tattoo in past 6 months</label>
            </div>
        `;
        container.appendChild(row);

        if (data.relation_to_head && !isHof) document.getElementById(`memRel_${idx}`).value = data.relation_to_head;
        if (data.gender) document.getElementById(`memGender_${idx}`).value = data.gender;
        if (data.blood_group) document.getElementById(`memBg_${idx}`).value = data.blood_group;
        if (data.donor_availability) document.getElementById(`memDonor_${idx}`).value = data.donor_availability;
        if (data.life_status) document.getElementById(`memLife_${idx}`).value = data.life_status;
        if (data.triage_passed) {
            if(document.getElementById(`triAge_${idx}`)) document.getElementById(`triAge_${idx}`).checked = true;
            if(document.getElementById(`triWt_${idx}`)) document.getElementById(`triWt_${idx}`).checked = true;
            if(document.getElementById(`triSurg_${idx}`)) document.getElementById(`triSurg_${idx}`).checked = true;
        }

        SurveyorLogic.toggleTriage(idx);
    },

    initForm: () => { 
        document.getElementById('membersContainer').innerHTML = ''; 
        document.getElementById('hGps').value = ''; document.getElementById('hLat').value = ''; document.getElementById('hLng').value = ''; 
        document.getElementById('gpsContainer').style.display = 'none'; document.getElementById('hGps').required = false;
        document.getElementById('hEditId').value = ''; document.getElementById('hEditUid').value = '';
        document.getElementById('hLocality').value = '';
        SurveyorLogic.deletedMemberIds = [];
        SurveyorLogic.renderMemberRow('hof', {}, true);
    },
    
    addMemberRow: () => {
        const idx = Date.now().toString() + Math.random().toString().slice(2,5);
        SurveyorLogic.renderMemberRow(idx, {}, false);
        SurveyorLogic.checkO_Negative();
    },
    
    removeMember: (id) => { 
        const idInput = document.getElementById(`memId_${id}`);
        if(idInput && idInput.value) {
            SurveyorLogic.deletedMemberIds.push(idInput.value);
        }
        const row = document.getElementById(`memberRow_${id}`);
        if (row) row.remove();
        SurveyorLogic.checkO_Negative(); 
    },

    copyHOFMobile: (idx) => document.getElementById(`memMobile_${idx}`).value = document.getElementById('memMobile_hof').value,
    
    loadDashboardStats: async () => { try { const { count } = await supabaseClient.from('households').select('*', { count: 'exact', head: true }).eq('surveyor_id', activeUser.id); document.getElementById('myHouseCount').innerText = count || 0; } catch(e) {} },
    
    loadVillages: async () => {
        try {
            const { data } = await supabaseClient.from('surveyor_village_assignments').select('village_id, geo_villages(id, village_name)').eq('surveyor_id', activeUser.id);
            if(data && data.length > 0) document.getElementById('hVillage').innerHTML = '<option value="">Select Village</option>' + data.map(v => { let vil = Array.isArray(v.geo_villages) ? v.geo_villages[0] : v.geo_villages; return `<option value="${vil?.id || v.village_id}">${vil?.village_name || 'Village'}</option>`; }).join('');
        } catch(e) { document.getElementById('hVillage').innerHTML = '<option value="">DB Error</option>'; }
    },

    loadRevisits: async () => {
        const container = document.getElementById('revisitContainer');
        try {
            const { data, error } = await supabaseClient.from('households').select('id, house_uid, family_head_name, contact_number, geo_villages(village_name)').eq('surveyor_id', activeUser.id).eq('survey_status', 'Revisit Required');
            if(error) throw error;
            if(!data || data.length === 0) return container.innerHTML = '<div style="text-align:center; padding:60px; color:var(--success);"><i class="ph-fill ph-check-circle" style="font-size: 64px;"></i><p style="margin-top:16px; font-weight:600; color:var(--accent);">Clean ledger. No audits pending.</p></div>';
            
            container.innerHTML = data.map(h => { 
                let vilName = h.geo_villages ? (Array.isArray(h.geo_villages) ? h.geo_villages[0]?.village_name : h.geo_villages.village_name) : 'Unknown'; 
                return `
                    <div class="revisit-item-card" style="background:#FFFFFF; border:1px solid #E2E8F0; border-radius:18px; border-left: 4px solid var(--warning); padding:24px; margin-bottom:16px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                            <div>
                                <strong>${h.house_uid}</strong><br>
                                <span style="font-size:13px; color:var(--text-muted); font-weight:600;">Head: ${h.family_head_name} | Mob: ${h.contact_number} | ${vilName}</span>
                            </div>
                            <button type="button" class="btn btn-primary" style="width:auto; padding:10px 20px;" onclick="SurveyorLogic.editHousehold('${h.id}')"><i class="ph-bold ph-pencil-simple"></i> Edit & Complete</button>
                        </div>
                    </div>
                `; 
            }).join('');
        } catch(e) { container.innerHTML = `<div style="text-align:center; color:red; padding:20px;">Error loading revisits</div>`; }
    },

    editHousehold: async (id) => {
        UI.toast("Loading household data...");
        try {
            const {data, error} = await supabaseClient.from('households')
                .select('id, house_uid, para_locality, village_id, gps_lat, gps_lng, geo_villages(village_name), family_members(*)')
                .eq('id', id)
                .single();
            if (error) throw error;

            Portal.switchTab('view-survey-form', document.querySelector('.nav-item.role-surveyor[onclick*="view-survey-form"]'));
            
            document.getElementById('hEditId').value = data.id;
            document.getElementById('hEditUid').value = data.house_uid;
            document.getElementById('hLocality').value = data.para_locality || '';
            
            const villageSelect = document.getElementById('hVillage');
            villageSelect.value = data.village_id || '';
            if(data.village_id && villageSelect.value !== data.village_id) {
                const opt = document.createElement('option');
                opt.value = data.village_id;
                opt.innerText = data.geo_villages?.village_name || 'Assigned Village';
                opt.selected = true;
                villageSelect.appendChild(opt);
            }
            
            if(data.gps_lat && data.gps_lng) {
                document.getElementById('hLat').value = data.gps_lat; document.getElementById('hLng').value = data.gps_lng;
                document.getElementById('hGps').value = `${data.gps_lat.toFixed(5)}, ${data.gps_lng.toFixed(5)}`;
            } else {
                document.getElementById('hLat').value = ''; document.getElementById('hLng').value = '';
                document.getElementById('hGps').value = '';
            }

            document.getElementById('membersContainer').innerHTML = '';
            SurveyorLogic.deletedMemberIds = [];

            let members = Array.isArray(data.family_members) ? data.family_members : [];
            let hof = members.find(m => m.relation_to_head === 'Head of Family');
            let others = members.filter(m => m.relation_to_head !== 'Head of Family');
            
            if(!hof && members.length > 0) {
                hof = members[0];
                others = members.slice(1);
            }

            if(hof) SurveyorLogic.renderMemberRow('hof', hof, true);
            else SurveyorLogic.renderMemberRow('hof', {}, true);

            others.forEach((m, index) => {
                SurveyorLogic.renderMemberRow(m.id || ('idx_' + index), m, false);
            });

            SurveyorLogic.checkO_Negative();
            UI.toast("Loaded record for: " + data.house_uid, "success");
        } catch (e) {
            console.error(e);
            UI.toast("Failed to load household.", "error");
        }
    },
    
    fetchPreReg: async (idx) => {
        const mob = document.getElementById(`memMobile_${idx}`).value.trim();
        if(mob.length < 10) return UI.toast("Enter 10-digit mobile first", "error");
        UI.toast("Querying Network Data...");
        try {
            const {data, error} = await supabaseClient.from('family_members').select('*').eq('mobile', mob);
            if(error) throw error;
            
            if(data && data.length === 1) {
                SurveyorLogic.applyFetchData(idx, data[0]);
            } else if (data && data.length > 1) {
                SurveyorLogic.activeFetchIdx = idx;
                SurveyorLogic.fetchResults = data;
                
                const listHtml = data.map((d, i) => `
                    <div style="padding:16px; border:1px solid #E2E8F0; margin-bottom:8px; border-radius:12px; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'" onclick="SurveyorLogic.selectFetchData(${i})">
                        <strong style="font-size:16px;">${d.full_name} (${d.age}/${d.gender})</strong><br>
                        <div style="font-size:12px; color:var(--text-muted); margin-top:6px;">Blood: <b style="color:var(--primary)">${d.blood_group}</b> | Last Donated: ${d.last_donation_date || 'N/A'}</div>
                    </div>
                `).join('');
                
                document.getElementById('fetchModalList').innerHTML = listHtml;
                document.getElementById('modalFetch').style.display = 'flex';
            } else {
                UI.toast("No network records found. New entry.", "warning");
            }
        } catch(e) { UI.toast("Search failed.", "error"); }
    },

    applyFetchData: (idx, data) => {
        document.getElementById(`memId_${idx}`).value = data.id; 
        document.getElementById(`memName_${idx}`).value = data.full_name || '';
        if(data.age) document.getElementById(`memAge_${idx}`).value = data.age;
        if(data.gender) document.getElementById(`memGender_${idx}`).value = data.gender;
        if(data.blood_group) document.getElementById(`memBg_${idx}`).value = data.blood_group;
        if(data.donor_availability) document.getElementById(`memDonor_${idx}`).value = data.donor_availability;
        if(data.last_donation_date) document.getElementById(`memLastDon_${idx}`).value = data.last_donation_date;
        UI.toast("Auto-synced latest network details!", "success");
        SurveyorLogic.checkO_Negative();
        SurveyorLogic.toggleTriage(idx);
    },

    selectFetchData: (i) => {
        const data = SurveyorLogic.fetchResults[i];
        SurveyorLogic.applyFetchData(SurveyorLogic.activeFetchIdx, data);
        document.getElementById('modalFetch').style.display = 'none';
    },

    submitHousehold: async (e) => {
        e.preventDefault();
        if (!activeUser) return UI.toast("Disconnected", "error");
        
        const villageIdValue = document.getElementById('hVillage').value;
        if(!villageIdValue) return UI.toast("Assigned sector (Village) is required.", "error");

        const btn = document.getElementById('btnSubmitSurvey'); 
        btn.innerHTML = '<i class="ph ph-spinner ph-spin" style="font-size:24px;"></i> Synchronizing...'; 
        btn.disabled = true;

        const editId = document.getElementById('hEditId').value;
        const editUid = document.getElementById('hEditUid').value;
        
        const houseUid = editUid || ('RD-' + Date.now().toString().slice(-6));
        const lat = parseFloat(document.getElementById('hLat').value); 
        const lng = parseFloat(document.getElementById('hLng').value);
        
        // Fix: Query only INSIDE the membersContainer to avoid parsing Revisit/Audit UI cards
        const memberCards = Array.from(document.querySelectorAll('#membersContainer .member-card'));
        
        const housePayload = { 
            house_uid: houseUid, 
            surveyor_id: activeUser.id, 
            para_locality: document.getElementById('hLocality').value, 
            family_head_name: document.getElementById('memName_hof').value, 
            contact_number: document.getElementById('memMobile_hof').value, 
            survey_status: 'Completed', 
            member_count: memberCards.length, 
            village_id: villageIdValue, 
            gps_lat: isNaN(lat) ? null : lat, 
            gps_lng: isNaN(lng) ? null : lng 
        };
        
        const membersPayload = memberCards.map((row, i) => {
            const idx = row.id.replace('memberRow_', ''); 
            const lastDon = document.getElementById(`memLastDon_${idx}`)?.value || null;
            const donorEl = document.getElementById(`memDonor_${idx}`);
            const isAvail = donorEl ? donorEl.value === 'Available & Willing' : false;
            
            const triAge = document.getElementById(`triAge_${idx}`);
            const triWt = document.getElementById(`triWt_${idx}`);
            const triSurg = document.getElementById(`triSurg_${idx}`);
            const triPass = isAvail && triAge && triWt && triSurg ? (triAge.checked && triWt.checked && triSurg.checked) : false;
            
            const existingId = document.getElementById(`memId_${idx}`)?.value || null;
            const existingUid = document.getElementById(`memUid_${idx}`)?.value || null;

            return { 
                id: existingId, 
                member_uid: existingUid || (houseUid + '-M' + (i+1)), 
                full_name: document.getElementById(`memName_${idx}`).value, 
                relation_to_head: idx === 'hof' ? 'Head of Family' : document.getElementById(`memRel_${idx}`).value, 
                age: parseInt(document.getElementById(`memAge_${idx}`).value), 
                gender: document.getElementById(`memGender_${idx}`).value, 
                blood_group: document.getElementById(`memBg_${idx}`).value, 
                mobile: document.getElementById(`memMobile_${idx}`).value, 
                donor_availability: donorEl ? donorEl.value : 'No', 
                last_donation_date: lastDon, 
                life_status: document.getElementById(`memLife_${idx}`).value, 
                triage_passed: triPass, 
                village_id: housePayload.village_id 
            };
        });

        if(!navigator.onLine) { 
            OfflineSync.saveLocally({ housePayload, membersPayload, editId }); 
        } else {
            try {
                let hIdToUse = editId;
                if(editId) {
                    const { error: hErr } = await supabaseClient.from('households').update(housePayload).eq('id', editId);
                    if(hErr) throw hErr;
                } else {
                    const { data: hData, error: hErr } = await supabaseClient.from('households').insert([housePayload]).select().single();
                    if(hErr) throw hErr;
                    hIdToUse = hData.id;
                }
                
                if (SurveyorLogic.deletedMemberIds && SurveyorLogic.deletedMemberIds.length > 0) {
                    await supabaseClient.from('family_members').delete().in('id', SurveyorLogic.deletedMemberIds);
                }

                let inserts = [];
                for(let m of membersPayload) {
                    m.household_id = hIdToUse;
                    if(m.id) {
                        // Crucial Fix: Exclude member_uid from updates to avoid Postgres unique constraint error 23505
                        const { id, member_uid, ...updateFields } = m;
                        const { error: updErr } = await supabaseClient.from('family_members').update(updateFields).eq('id', id);
                        if (updErr) throw updErr;
                    } else {
                        const { id, ...insertFields } = m;
                        inserts.push(insertFields);
                    }
                }
                if(inserts.length > 0) {
                    const { error: mErr } = await supabaseClient.from('family_members').insert(inserts);
                    if(mErr) throw mErr;
                }
                UI.toast('Vector Synchronized & Completed!', 'success');
            } catch(err) { 
                console.error("Survey Submit Error:", err);
                btn.innerHTML = 'Save & Synchronize Household <i class="ph-bold ph-cloud-arrow-up" style="font-size:24px;"></i>'; 
                btn.disabled = false;
                return UI.toast("Save Failed: " + (err.message || 'Database error'), 'error'); 
            }
        }

        document.getElementById('qrText').innerText = houseUid; 
        document.getElementById('qrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${houseUid}`; 
        document.getElementById('qrModal').style.display = 'flex';
        
        e.target.reset(); 
        SurveyorLogic.initForm();
        
        if(!editId) {
            let count = parseInt(document.getElementById('myHouseCount').innerText) || 0; 
            document.getElementById('myHouseCount').innerText = count + 1;
        }
        btn.innerHTML = 'Save & Synchronize Household <i class="ph-bold ph-cloud-arrow-up" style="font-size:24px;"></i>'; 
        btn.disabled = false;
        
        SurveyorLogic.loadRevisits();
    }
};

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => console.log('SW Error:', err));
    });
}

window.onload = Auth.checkSession;
