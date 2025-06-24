document.addEventListener('DOMContentLoaded', () => {
    // --- The server URL for your IPTV provider ---
    const SERVER_URL = 'http://cms3worldadventure.in';
    // --- We no longer need a public CORS proxy constant ---


    // --- Element References ---
    const loginSection = document.getElementById('login-section');
    const mainIptvSection = document.getElementById('main-iptv-section');
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');
    const logoutButton = document.getElementById('logout-button');
    const videoPlayer = document.getElementById('video-player');
    const currentChannelName = document.getElementById('current-channel-name');
    const categoryList = document.getElementById('category-list');
    const channelList = document.getElementById('channel-list');
    const epgGrid = document.getElementById('epg-grid');
    const channelSearchInput = document.getElementById('channel-search');
    const epgDateFilter = document.getElementById('epg-date-filter');

    // --- App State ---
    let username = '';
    let password = '';
    let currentActiveChannelId = null;
    let allChannels = []; // Cache for channels in the current category
    let epgDataCache = null; // A Map to hold all EPG data for the session

    // --- Utility Functions ---

    /**
     * Shows a specific section and hides others.
     * @param {HTMLElement} sectionToShow The section to display.
     */
    function showSection(sectionToShow) {
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        sectionToShow.classList.add('active');
    }

    /**
     * Makes an API request to the Xtream Codes panel using our Netlify function as a proxy.
     * @param {string} action - The API action (e.g., 'get_live_categories').
     * @param {object} params - Additional parameters for the API call.
     * @returns {Promise<any>} A promise that resolves with the JSON response.
     */
    async function fetchXtreamCodesApi(action, params = {}) {
        if (!SERVER_URL || !username || !password) {
            loginError.textContent = 'Login credentials are not set.';
            return null;
        }
        
        // 1. Construct the target URL that we want to fetch from the IPTV provider.
        const targetUrl = new URL(`${SERVER_URL}/player_api.php`);
        targetUrl.searchParams.append('username', username);
        targetUrl.searchParams.append('password', password);
        targetUrl.searchParams.append('action', action);

        for (const key in params) {
            targetUrl.searchParams.append(key, params[key]);
        }

        // 2. Construct the URL to our own proxy function.
        // This path `/.netlify/functions/proxy` is automatically created by Netlify.
        // We pass the real IPTV server URL as a query parameter called 'url'.
        const proxyUrl = `/.netlify/functions/proxy?url=${encodeURIComponent(targetUrl.toString())}`;

        try {
            // 3. Fetch the data from our own proxy function.
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }
            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                 if (text.includes('{"user_info":{"auth":0}}')) {
                    throw new Error('Authentication failed. Check credentials.');
                 }
                 throw new Error('Received non-JSON response from server.');
            }
        } catch (error) {
            console.error('Error fetching Xtream Codes API:', error);
            loginError.textContent = `API Error: ${error.message}`;
            return null;
        }
    }

    // --- Login & Logout Logic ---

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        username = document.getElementById('username').value.trim();
        password = document.getElementById('password').value.trim();
        loginError.textContent = 'Logging in...';

        if (!username || !password) {
            loginError.textContent = 'Username and Password are required.';
            return;
        }

        const data = await fetchXtreamCodesApi('get_live_categories');
        
        if (!data || (data.user_info && data.user_info.auth === 0)) {
             loginError.textContent = 'Login failed. Please check your credentials.';
        } else {
            console.log('Login successful!');
            loginError.textContent = '';
            localStorage.setItem('xtream_username', username);
            localStorage.setItem('xtream_password', password);

            showSection(mainIptvSection);
            await initializeIPTVContent();
        }
    });

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('xtream_username');
        localStorage.removeItem('xtream_password');

        username = password = '';
        videoPlayer.pause();
        videoPlayer.src = '';
        currentChannelName.textContent = 'Select a channel to play';
        categoryList.innerHTML = '';
        channelList.innerHTML = '';
        epgGrid.innerHTML = '<p>Select a channel to view its EPG.</p>';
        currentActiveChannelId = null;
        allChannels = [];
        epgDataCache = null;
        channelSearchInput.value = '';
        epgDateFilter.value = '';

        showSection(loginSection);
    });


    // --- Core IPTV Content Functions ---

    /**
     * Initializes categories and pre-caches EPG data after login.
     */
    async function initializeIPTVContent() {
        const categories = await fetchXtreamCodesApi('get_live_categories');
        if (categories && Array.isArray(categories)) {
            displayCategories(categories);
            if (categories.length > 0) {
                const firstCategory = categories[0];
                await displayChannels(firstCategory.category_id);
                const firstCategoryElement = categoryList.querySelector(`[data-category-id="${firstCategory.category_id}"]`);
                if (firstCategoryElement) {
                    firstCategoryElement.classList.add('active');
                }
            }
        } else {
             console.error("Could not load categories.", categories);
             loginError.textContent = "Could not load categories. Check API or credentials."
        }
        await cacheAllEpgData();
    }

    /**
     * Fetches and caches all EPG data into the epgDataCache Map.
     */
    async function cacheAllEpgData() {
        console.log("Fetching and caching all EPG data...");
        epgGrid.innerHTML = '<p>Loading EPG data...</p>';
        epgDataCache = new Map();
        
        const targetEpgUrl = `${SERVER_URL}/xmltv.php?username=${username}&password=${password}`;
        // Use our proxy for the EPG call as well.
        const proxyEpgUrl = `/.netlify/functions/proxy?url=${encodeURIComponent(targetEpgUrl)}`;

        try {
            const response = await fetch(proxyEpgUrl);
            if (!response.ok) throw new Error(`Failed to fetch EPG XML: ${response.status}`);

            const xmlText = await response.text();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, "application/xml");

            const programs = xmlDoc.querySelectorAll('programme');
            programs.forEach(program => {
                const channelId = program.getAttribute('channel');
                if (!epgDataCache.has(channelId)) {
                    epgDataCache.set(channelId, []);
                }

                const startStr = program.getAttribute('start').replace(/ /g, '');
                const stopStr = program.getAttribute('stop').replace(/ /g, '');

                const parseDate = (dateStr) => {
                    const year = dateStr.substring(0, 4);
                    const month = dateStr.substring(4, 6);
                    const day = dateStr.substring(6, 8);
                    const hour = dateStr.substring(8, 10);
                    const minute = dateStr.substring(10, 12);
                    const second = dateStr.substring(12, 14);
                    const offset = dateStr.substring(14);
                    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
                };

                epgDataCache.get(channelId).push({
                    start: parseDate(startStr),
                    stop: parseDate(stopStr),
                    title: program.querySelector('title')?.textContent || 'No Title',
                    description: program.querySelector('desc')?.textContent || 'No description.',
                });
            });

            epgDataCache.forEach(channelPrograms => {
                channelPrograms.sort((a, b) => a.start - b.start);
            });
            console.log("EPG data cached successfully for", epgDataCache.size, "channels.");
            // Clear the "Loading" message
            epgGrid.innerHTML = '<p>Select a channel to view its EPG.</p>';

        } catch (error) {
            console.error('Error caching EPG data:', error);
            // Display a user-friendly error message in the EPG grid
            epgGrid.innerHTML = `<p class="error-message">Could not load EPG data. The provider's server may be temporarily down.</p>`;
        }
    }


    /**
     * Renders the category list in the sidebar.
     * @param {Array<object>} categories Array of category objects.
     */
    function displayCategories(categories) {
        categoryList.innerHTML = '';
        categories.forEach(category => {
            const listItem = document.createElement('li');
            listItem.textContent = category.category_name;
            listItem.dataset.categoryId = category.category_id;
            listItem.addEventListener('click', async () => {
                document.querySelectorAll('#category-list li').forEach(li => li.classList.remove('active'));
                listItem.classList.add('active');
                await displayChannels(category.category_id);
                epgGrid.innerHTML = '<p>Select a channel to view its EPG.</p>';
                channelSearchInput.value = '';
            });
            categoryList.appendChild(listItem);
        });
    }

    /**
     * Fetches and displays channels for a given category.
     * @param {string} categoryId The ID of the category.
     * @param {string} [searchTerm=''] Optional search term to filter channels.
     */
    async function displayChannels(categoryId, searchTerm = '') {
        channelList.innerHTML = '<p>Loading channels...</p>';
        const streams = await fetchXtreamCodesApi('get_live_streams', { category_id: categoryId });
        allChannels = (Array.isArray(streams)) ? streams : [];

        const filteredChannels = allChannels.filter(stream =>
            stream.name.toLowerCase().includes(searchTerm.toLowerCase())
        );

        channelList.innerHTML = '';

        if (filteredChannels.length > 0) {
            const fragment = document.createDocumentFragment();
            filteredChannels.forEach(stream => {
                const channelItem = document.createElement('div');
                channelItem.className = 'channel-item';
                channelItem.dataset.streamId = stream.stream_id;
                channelItem.dataset.epgId = stream.epg_channel_id;

                if (stream.stream_icon) {
                    const img = document.createElement('img');
                    img.src = stream.stream_icon;
                    img.alt = stream.name;
                    // FIX: This will hide the broken image icon if the logo fails to load
                    img.onerror = (e) => { e.target.style.display='none'; }
                    channelItem.appendChild(img);
                }
                const span = document.createElement('span');
                span.textContent = stream.name;
                channelItem.appendChild(span);

                channelItem.addEventListener('click', () => {
                    document.querySelectorAll('.channel-item').forEach(item => item.classList.remove('active'));
                    channelItem.classList.add('active');
                    currentActiveChannelId = stream.stream_id;
                    // The video stream URL does NOT need the proxy
                    const streamUrl = `${SERVER_URL}/live/${username}/${password}/${stream.stream_id}.m3u8`;
                    playStream(streamUrl, stream.name);
                    displayEpgForChannel(stream.epg_channel_id);
                });
                fragment.appendChild(channelItem);
            });
            channelList.appendChild(fragment);
        } else {
            channelList.innerHTML = '<p>No channels found.</p>';
        }
    }

    channelSearchInput.addEventListener('input', () => {
        const activeCategoryElement = document.querySelector('#category-list li.active');
        if (activeCategoryElement) {
            const categoryId = activeCategoryElement.dataset.categoryId;
            displayChannels(categoryId, channelSearchInput.value);
        }
    });

    /**
     * Initializes HLS.js and plays the stream.
     * @param {string} streamUrl The URL of the stream.
     * @param {string} channelName The name of the channel.
     */
    function playStream(streamUrl, channelName) {
        currentChannelName.textContent = `Now Playing: ${channelName}`;
        if (Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(streamUrl);
            hls.attachMedia(videoPlayer);
            hls.on(Hls.Events.ERROR, function(event, data) {
                 if (data.fatal) {
                    console.error(`Fatal HLS error: ${data.type}`, data);
                 }
            });
        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            videoPlayer.src = streamUrl;
        } else {
            currentChannelName.textContent = 'HLS streaming is not supported in this browser.';
        }
        videoPlayer.play().catch(e => console.error("Video play failed:", e));
    }

    /**
     * Displays EPG for a channel using the pre-cached data.
     * @param {string} epgChannelId The EPG channel ID.
     * @param {string} [filterDate=''] Optional date string (YYYY-MM-DD).
     */
    function displayEpgForChannel(epgChannelId, filterDate = '') {
        if (!epgChannelId) {
            epgGrid.innerHTML = '<p>EPG not available for this channel.</p>';
            return;
        }

        const channelPrograms = epgDataCache.get(epgChannelId);

        if (!channelPrograms || channelPrograms.length === 0) {
            epgGrid.innerHTML = '<p>No EPG data found for this channel.</p>';
            return;
        }

        let programsToDisplay = channelPrograms;

        if (filterDate) {
            const selectedDate = new Date(`${filterDate}T00:00:00`);
            const nextDay = new Date(selectedDate);
            nextDay.setDate(selectedDate.getDate() + 1);

            programsToDisplay = channelPrograms.filter(p => p.start >= selectedDate && p.start < nextDay);
        }

        if (programsToDisplay.length > 0) {
            epgGrid.innerHTML = '';
            const fragment = document.createDocumentFragment();
            programsToDisplay.forEach(program => {
                const epgEntry = document.createElement('div');
                epgEntry.className = 'epg-entry';
                const startTime = program.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const stopTime = program.stop.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                epgEntry.innerHTML = `
                    <h4>${program.title}</h4>
                    <p><strong>${startTime} - ${stopTime}</strong></p>
                    <p>${program.description}</p>
                `;
                fragment.appendChild(epgEntry);
            });
            epgGrid.appendChild(fragment);
        } else {
            epgGrid.innerHTML = '<p>No programs for the selected date.</p>';
        }
    }

    epgDateFilter.addEventListener('change', () => {
        const activeChannelElement = document.querySelector('.channel-item.active');
        if (activeChannelElement) {
            const epgId = activeChannelElement.dataset.epgId;
            displayEpgForChannel(epgId, epgDateFilter.value);
        }
    });

    // --- Auto-Login on Load ---
    (async () => {
        const storedUsername = localStorage.getItem('xtream_username');
        const storedPassword = localStorage.getItem('xtream_password');

        if (storedUsername && storedPassword) {
            username = storedUsername;
            password = storedPassword;

            document.getElementById('username').value = username;

            console.log("Attempting to auto-login...");
            showSection(mainIptvSection);
            await initializeIPTVContent();
        } else {
            showSection(loginSection);
        }
    })();
});
