// --- STATE MANAGEMENT ---
let currentUser = null;
let mockSurveys = [
    { id: 'H-0999', head: 'Ramesh Das', members: 4, status: 'Completed' },
    { id: 'H-1000', head: 'Sunita Roy', members: 2, status: 'In Progress' }
];

// --- DOM ELEMENTS ---
const views = {
    login: document.getElementById('login-view'),
    admin: document.getElementById('admin-view'),
    surveyer: document.getElementById('surveyer-view'),
    addHouse: document.getElementById('add-house-view')
};

const ui = {
    userInfo: document.getElementById('user-info'),
    welcomeMsg: document.getElementById('welcome-msg'),
    surveyList: document.getElementById('recent-surveys-list'),
    houseIdInput: document.getElementById('house-id')
};

// --- ROUTING / VIEW LOGIC ---
function showView(viewName) {
    // Hide all views
    Object.values(views).forEach(view => view.classList.add('hidden'));
    // Show target view
    views[viewName].classList.remove('hidden');
}

function updateNav() {
    if (currentUser) {
        ui.userInfo.classList.remove('hidden');
        ui.welcomeMsg.textContent = `Hello, ${currentUser.role}`;
    } else {
        ui.userInfo.classList.add('hidden');
    }
}

// --- AUTHENTICATION ---
document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('login-username').value;
    const pass = document.getElementById('login-password').value;

    if (pass === '123') {
        if (user === 'admin') {
            currentUser = { username: 'admin', role: 'Admin' };
            showView('admin');
        } else if (user === 'surveyer') {
            currentUser = { username: 'surveyer', role: 'Surveyer' };
            renderSurveyList();
            showView('surveyer');
        } else {
            alert('Invalid credentials');
            return;
        }
        updateNav();
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    currentUser = null;
    document.getElementById('login-form').reset();
    updateNav();
    showView('login');
});

// --- SURVEYER LOGIC ---
document.getElementById('btn-new-house').addEventListener('click', () => {
    // Generate a mock ID
    ui.houseIdInput.value = `H-${Math.floor(1000 + Math.random() * 9000)}`;
    showView('addHouse');
});

document.getElementById('btn-back-dashboard').addEventListener('click', () => {
    showView('surveyer');
});

// Add House Submission
document.getElementById('house-form').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const newSurvey = {
        id: ui.houseIdInput.value,
        head: document.getElementById('member-name').value,
        members: 1, // Defaulting to 1 for the head
        status: 'Completed'
    };
    
    // Save to state
    mockSurveys.unshift(newSurvey);
    
    alert(`House ${newSurvey.id} saved locally!`);
    e.target.reset();
    
    renderSurveyList();
    showView('surveyer');
});

function renderSurveyList() {
    ui.surveyList.innerHTML = mockSurveys.map(survey => `
        <li>
            <div>
                <strong>${survey.id}</strong> - ${survey.head} 
                <span style="color: #6b7280; font-size: 0.85em;">(${survey.members} members)</span>
            </div>
            <span style="color: ${survey.status === 'Completed' ? 'green' : 'orange'}">${survey.status}</span>
        </li>
    `).join('');
}