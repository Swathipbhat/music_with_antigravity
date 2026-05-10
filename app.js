// ===== Track Data =====
const tracks = [
    {
        id: 1, type: 'audio',
        title: "Donut", artist: "Lukrembo", album: "Lo-Fi Vibes",
        src: "https://res.cloudinary.com/dgfravzkb/video/upload/q_auto/f_auto/v1778341062/Lukrembo_-_Donut_freetouse.com_ts7xp1.mp3",
        cover: "donut_album_art.png", accentColor: "232, 67, 147"
    },
    {
        id: 2, type: 'audio',
        title: "Office", artist: "Aylex", album: "Lo-Fi Vibes",
        src: "https://res.cloudinary.com/dgfravzkb/video/upload/v1778341063/Aylex_-_Office_freetouse.com_w3gd1c.mp3",
        cover: "office_album_art.png", accentColor: "59, 130, 246"
    }
];

let nextId = 3;
let currentPlaylist = 'lofi'; // 'lofi', 'liked', or 'custom_...'
let customPlaylists = []; // { id: string, name: string, trackIds: [] }
let contextMenuTargetTrackId = null;

// ===== Persistence =====
function loadSavedData() {
    try {
        const savedYT = localStorage.getItem('vibe_player_yt_tracks');
        if (savedYT) {
            const ytTracks = JSON.parse(savedYT);
            ytTracks.forEach(t => {
                if (!tracks.find(existing => existing.videoId === t.videoId)) {
                    t.id = nextId++;
                    tracks.push(t);
                }
            });
        }
        
        const savedLikes = localStorage.getItem('vibe_player_likes');
        if (savedLikes) {
            const likedTrackIds = JSON.parse(savedLikes);
            tracks.forEach(t => {
                if (likedTrackIds.includes(t.videoId || t.id)) {
                    t.isLiked = true;
                }
            });
        }
        
        const savedPlaylists = localStorage.getItem('vibe_player_playlists');
        if (savedPlaylists) {
            customPlaylists = JSON.parse(savedPlaylists);
        }
    } catch(e) { console.warn('Failed to load saved data:', e); }
    
    renderSidebarPlaylists();
}

function saveYouTubeTracks() {
    try {
        const ytTracks = tracks.filter(t => t.type === 'youtube');
        localStorage.setItem('vibe_player_yt_tracks', JSON.stringify(ytTracks));
    } catch(e) { console.warn('Failed to save tracks:', e); }
}

function saveLikes() {
    const likes = tracks.filter(t => t.isLiked).map(t => t.videoId || t.id);
    try { localStorage.setItem('vibe_player_likes', JSON.stringify(likes)); } catch(e) {}
}

function toggleLike(identifier) {
    const track = tracks.find(t => t.id === identifier || t.videoId === identifier);
    if (!track) return;
    track.isLiked = !track.isLiked;
    saveLikes();
    
    if (currentTrackIndex >= 0 && (tracks[currentTrackIndex].id === identifier || tracks[currentTrackIndex].videoId === identifier)) {
        $('#npLike').classList.toggle('active', track.isLiked);
    }
    
    renderTracks();
    updateSongCount();
}

function saveCustomPlaylists() {
    try { localStorage.setItem('vibe_player_playlists', JSON.stringify(customPlaylists)); } catch(e) {}
}

function renderSidebarPlaylists() {
    const container = $('#customPlaylistsContainer');
    if (!container) return;
    container.innerHTML = '';
    customPlaylists.forEach(pl => {
        const a = document.createElement('a');
        a.href = '#';
        a.className = 'playlist-item ' + (currentPlaylist === pl.id ? 'active-playlist' : '');
        a.dataset.id = pl.id;
        a.innerHTML = `
            <div class="playlist-thumb gradient-1">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
            </div>
            <div class="playlist-info">
                <span class="playlist-name">${pl.name}</span>
                <span class="playlist-meta">${pl.trackIds.length} songs</span>
            </div>
        `;
        a.addEventListener('click', (e) => {
            e.preventDefault();
            selectCustomPlaylist(pl.id);
        });
        container.appendChild(a);
    });
}

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== Audio Engine =====
const audio = new Audio();
audio.crossOrigin = "anonymous";
audio.volume = 0.7;
audio.preload = "metadata";

// ===== State =====
let currentTrackIndex = -1;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0;
let isDraggingProgress = false;
let isDraggingVolume = false;
let currentVolume = 0.7;

// ===== YouTube Engine =====
let ytPlayer = null;
let ytReady = false;
let ytProgressTimer = null;
let ytPendingVideoId = null;

// Called by YouTube IFrame API when ready
function onYouTubeIframeAPIReady() {
    ytPlayer = new YT.Player('ytPlayer', {
        height: '1', width: '1',
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0 },
        events: {
            onReady: () => {
                ytReady = true;
                ytPlayer.setVolume(currentVolume * 100);
                if (ytPendingVideoId) {
                    ytPlayer.loadVideoById(ytPendingVideoId);
                    ytPendingVideoId = null;
                }
            },
            onStateChange: onYTStateChange
        }
    });
}

function onYTStateChange(e) {
    if (e.data === YT.PlayerState.ENDED) {
        stopYTProgress();
        if (repeatMode === 2) {
            ytPlayer.seekTo(0); ytPlayer.playVideo();
            startYTProgress();
        } else if (repeatMode === 1 || currentTrackIndex < tracks.length - 1 || isShuffle) {
            playNext();
        } else {
            isPlaying = false;
            updatePlayPauseUI();
            updateTrackHighlight();
        }
    } else if (e.data === YT.PlayerState.PLAYING) {
        isPlaying = true;
        updatePlayPauseUI();
        updateTrackHighlight();
        startYTProgress();
    } else if (e.data === YT.PlayerState.PAUSED) {
        isPlaying = false;
        updatePlayPauseUI();
        updateTrackHighlight();
        stopYTProgress();
    }
}

function startYTProgress() {
    stopYTProgress();
    ytProgressTimer = setInterval(updateYTProgress, 250);
}

function stopYTProgress() {
    if (ytProgressTimer) { clearInterval(ytProgressTimer); ytProgressTimer = null; }
}

function updateYTProgress() {
    if (!ytPlayer || !ytPlayer.getDuration || isDraggingProgress) return;
    const dur = ytPlayer.getDuration();
    const cur = ytPlayer.getCurrentTime();
    if (dur > 0) {
        const pct = (cur / dur) * 100;
        $('#progressBarFill').style.width = pct + '%';
        $('#progressBarHandle').style.left = pct + '%';
        $('#npCurrentTime').textContent = formatTime(cur);
        $('#npTotalTime').textContent = formatTime(dur);
    }
}

function getActiveType() {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) return 'audio';
    return tracks[currentTrackIndex].type || 'audio';
}

// ===== YouTube URL Parsing =====
function extractVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

async function fetchVideoInfo(videoId) {
    try {
        const resp = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        return {
            title: data.title || 'YouTube Video',
            artist: data.author_name || 'Unknown Artist',
            cover: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
        };
    } catch {
        return {
            title: 'YouTube Video',
            artist: 'Unknown Artist',
            cover: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
        };
    }
}

// ===== Add YouTube Track =====
async function addYouTubeTrack() {
    const input = $('#ytUrlInput');
    const btn = $('#ytAddBtn');
    const status = $('#ytStatus');
    const url = input.value.trim();

    if (!url) { showStatus('Please paste a YouTube URL', 'error'); return; }

    const videoId = extractVideoId(url);
    if (!videoId) { showStatus('Invalid YouTube URL. Try pasting a full link.', 'error'); return; }

    // Check duplicate
    if (tracks.find(t => t.videoId === videoId)) {
        showStatus('This video is already in your playlist!', 'error'); return;
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="yt-spinner"></div><span>Adding...</span>';
    showStatus('Fetching video info...', 'loading');

    const info = await fetchVideoInfo(videoId);

    const track = {
        id: nextId++, type: 'youtube', videoId,
        title: info.title, artist: info.artist, album: 'YouTube',
        cover: info.cover, accentColor: "255, 0, 51"
    };

    tracks.push(track);
    appendTrackRow(track, tracks.length - 1);
    updateSongCount();
    saveYouTubeTracks();

    input.value = '';
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Add</span>';
    showStatus(`✓ Added "${info.title}"`, 'success');
    setTimeout(() => showStatus('', ''), 4000);
}

function showStatus(msg, type) {
    const el = $('#ytStatus');
    el.textContent = msg;
    el.className = 'yt-status ' + (type || '');
}

function selectCustomPlaylist(id) {
    currentPlaylist = id;
    const pl = customPlaylists.find(p => p.id === id);
    if (!pl) return;
    
    $$('.playlist-item').forEach(el => el.classList.remove('active-playlist'));
    const sidebarItem = $(`.playlist-item[data-id="${id}"]`);
    if (sidebarItem) sidebarItem.classList.add('active-playlist');
    
    $('.hero-title').textContent = pl.name;
    $('.hero-description').textContent = 'Your custom playlist.';
    $('.hero-badge').textContent = 'PLAYLIST';
    $('.hero-badge').style.background = 'rgba(255, 255, 255, 0.2)';
    $('.hero-badge').style.color = '#fff';
    updateBackgroundAccent('88, 101, 242'); // Different color for custom playlists
    
    renderTracks();
    updateSongCount();
}

function updateSongCount() {
    let visibleTracks = tracks;
    if (currentPlaylist === 'liked') {
        visibleTracks = tracks.filter(t => t.isLiked);
    } else if (currentPlaylist.startsWith('custom_')) {
        const pl = customPlaylists.find(p => p.id === currentPlaylist);
        visibleTracks = pl ? tracks.filter(t => pl.trackIds.includes(t.videoId || t.id)) : [];
    }
    const count = visibleTracks.length;
    
    // Update hero meta
    const metaItems = $$('.hero-meta-item');
    if (metaItems[1]) metaItems[1].textContent = `${count} songs`;
    
    // Update sidebar counts
    const lofiMeta = document.querySelector('#playlistLofi .playlist-meta');
    if (lofiMeta) lofiMeta.textContent = `${tracks.length} songs`;
    
    const likedMeta = document.querySelector('#playlistLiked .playlist-meta');
    if (likedMeta) likedMeta.textContent = `${tracks.filter(t => t.isLiked).length} songs`;
    
    customPlaylists.forEach(pl => {
        const sidebarItemMeta = document.querySelector(`.playlist-item[data-id="${pl.id}"] .playlist-meta`);
        if (sidebarItemMeta) sidebarItemMeta.textContent = `${pl.trackIds.length} songs`;
    });
}

// ===== Render Tracks =====
function renderTracks() {
    $('#trackList').innerHTML = '';
    
    let visibleTracks = tracks;
    if (currentPlaylist === 'liked') {
        visibleTracks = tracks.filter(t => t.isLiked);
    } else if (currentPlaylist.startsWith('custom_')) {
        const pl = customPlaylists.find(p => p.id === currentPlaylist);
        visibleTracks = pl ? tracks.filter(t => pl.trackIds.includes(t.videoId || t.id)) : [];
    }
    
    visibleTracks.forEach(track => {
        const i = tracks.indexOf(track);
        appendTrackRow(track, i);
    });
    
    // Load durations for audio tracks
    visibleTracks.filter(t => t.type === 'audio').forEach((track) => {
        const idx = tracks.indexOf(track);
        if (track.duration) {
            const el = $(`#duration-${idx}`);
            if (el) el.textContent = formatTime(track.duration);
            return;
        }
        const tempAudio = new Audio();
        tempAudio.crossOrigin = "anonymous";
        tempAudio.preload = "metadata";
        tempAudio.src = track.src;
        tempAudio.addEventListener('loadedmetadata', () => {
            const el = $(`#duration-${idx}`);
            if (el) el.textContent = formatTime(tempAudio.duration);
            track.duration = tempAudio.duration;
            updateTotalDuration();
        });
    });
    updateTotalDuration();
}

function appendTrackRow(track, i) {
    const container = $('#trackList');
    const row = document.createElement('div');
    row.className = 'track-row';
    row.dataset.index = i;
    row.id = `track-row-${i}`;

    const ytBadge = track.type === 'youtube'
        ? `<span class="yt-badge"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>YT</span>`
        : '';

    const deleteBtn = track.type === 'youtube'
        ? `<button class="yt-delete-btn" title="Remove track"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`
        : '';
        
    const likeBtn = `<button class="track-like-btn ${track.isLiked ? 'active' : ''}" title="Like track"><svg viewBox="0 0 24 24" fill="${track.isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg></button>`;

    row.innerHTML = `
        <div class="track-num">
            <span class="track-num-text">${i + 1}</span>
            <div class="track-num-play">
                <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
            </div>
        </div>
        <div class="track-title-cell">
            <img class="track-thumb" src="${track.cover}" alt="${track.title}" loading="lazy" onerror="this.src='donut_album_art.png'">
            <div class="track-title-info">
                <span class="track-title">${track.title} ${ytBadge}</span>
                <span class="track-artist">${track.artist}</span>
            </div>
        </div>
        <span class="track-album">${track.album}</span>
        <div class="track-actions">
            ${likeBtn}
            <span class="track-duration" id="duration-${i}">${track.type === 'youtube' ? '—' : '--:--'}</span>
            ${deleteBtn}
            <button class="track-more-btn" title="More options">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="5" r="1"></circle>
                    <circle cx="12" cy="19" r="1"></circle>
                </svg>
            </button>
        </div>
    `;
    row.addEventListener('click', (e) => {
        if (e.target.closest('.yt-delete-btn')) {
            e.stopPropagation();
            deleteTrack(i);
        } else if (e.target.closest('.track-like-btn')) {
            e.stopPropagation();
            toggleLike(track.id || track.videoId);
        } else if (e.target.closest('.track-more-btn')) {
            e.stopPropagation();
            showContextMenu(e, track.id || track.videoId);
        } else {
            playTrack(i);
        }
    });
    container.appendChild(row);
}

// ===== Context Menu Logic =====
function showContextMenu(e, trackId) {
    contextMenuTargetTrackId = trackId;
    const menu = $('#contextMenu');
    const list = $('#contextMenuList');
    
    list.innerHTML = '';
    
    if (customPlaylists.length === 0) {
        list.innerHTML = '<div class="context-menu-empty">No custom playlists</div>';
    } else {
        customPlaylists.forEach(pl => {
            const btn = document.createElement('button');
            btn.className = 'context-menu-item';
            btn.textContent = pl.name;
            btn.addEventListener('click', () => {
                addToCustomPlaylist(pl.id, contextMenuTargetTrackId);
                hideContextMenu();
            });
            list.appendChild(btn);
        });
    }
    
    menu.classList.add('show');
    
    // Position menu
    const rect = menu.getBoundingClientRect();
    let x = e.clientX - rect.width; // open to the left
    let y = e.clientY;
    
    if (x < 10) x = e.clientX + 10; // if too far left, open to right
    if (y + rect.height > window.innerHeight) {
        y = window.innerHeight - rect.height - 10;
    }
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

function hideContextMenu() {
    $('#contextMenu').classList.remove('show');
    contextMenuTargetTrackId = null;
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('#contextMenu') && !e.target.closest('.track-more-btn')) {
        hideContextMenu();
    }
});

function addToCustomPlaylist(playlistId, trackId) {
    const pl = customPlaylists.find(p => p.id === playlistId);
    if (!pl) return;
    
    if (!pl.trackIds.includes(trackId)) {
        pl.trackIds.push(trackId);
        saveCustomPlaylists();
        updateSongCount();
        showStatus('Added to ' + pl.name, 'success');
        setTimeout(() => showStatus('', ''), 3000);
    } else {
        showStatus('Already in playlist', '');
        setTimeout(() => showStatus('', ''), 3000);
    }
}

function updateTotalDuration() {
    const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    if (total > 0) {
        const mins = Math.floor(total / 60);
        const secs = Math.floor(total % 60);
        $('#totalDuration').textContent = `${mins} min ${secs} sec`;
    }
}

// ===== Playback (Dual Engine) =====
function deleteTrack(index) {
    if (index < 0 || index >= tracks.length || tracks[index].type !== 'youtube') return;
    
    const isCurrent = currentTrackIndex === index;
    
    // Remove from array
    tracks.splice(index, 1);
    
    // Update local storage
    saveYouTubeTracks();
    
    // Update currentTrackIndex if it shifted
    if (currentTrackIndex > index) {
        currentTrackIndex--;
    } else if (isCurrent) {
        stopAll();
        currentTrackIndex = -1;
        updatePlayPauseUI();
        $('#npTrackName').textContent = "Select a track";
        $('#npArtistName').textContent = "—";
        $('#npAlbumImg').src = "donut_album_art.png";
        $('#npTotalTime').textContent = "0:00";
        $('#npCurrentTime').textContent = "0:00";
        $('#progressBarFill').style.width = '0%';
        $('#progressBarHandle').style.left = '0%';
        updateBackgroundAccent("20, 20, 20");
    }
    
    // Re-render
    renderTracks();
    updateSongCount();
    updateTrackHighlight();
}

function playTrack(index) {
    if (index < 0 || index >= tracks.length) return;
    const track = tracks[index];
    const sameTrack = currentTrackIndex === index;

    if (sameTrack && isPlaying) { pausePlayback(); return; }
    if (sameTrack && !isPlaying) { resumePlayback(); return; }

    // Stop current playback
    stopAll();
    currentTrackIndex = index;

    if (track.type === 'youtube') {
        playYouTube(track);
    } else {
        playAudio(track);
    }

    updateNowPlayingInfo();
    updateTrackHighlight();
    updateBackgroundAccent(track.accentColor);
}

function playAudio(track) {
    audio.src = track.src;
    audio.load();
    audio.play().then(() => {
        isPlaying = true;
        updatePlayPauseUI();
        updateTrackHighlight();
    }).catch(err => console.warn("Playback error:", err));
}

function playYouTube(track) {
    if (!ytReady) {
        ytPendingVideoId = track.videoId;
        showStatus('Loading YouTube player...', 'loading');
        return;
    }
    ytPlayer.loadVideoById(track.videoId);
    // State change handler will set isPlaying
}

function stopAll() {
    audio.pause();
    audio.currentTime = 0;
    stopYTProgress();
    if (ytReady && ytPlayer && ytPlayer.stopVideo) {
        try { ytPlayer.stopVideo(); } catch(e) {}
    }
    isPlaying = false;
}

function pausePlayback() {
    if (getActiveType() === 'youtube') {
        if (ytReady && ytPlayer) ytPlayer.pauseVideo();
    } else {
        audio.pause();
    }
    isPlaying = false;
    updatePlayPauseUI();
    updateTrackHighlight();
}

function resumePlayback() {
    if (getActiveType() === 'youtube') {
        if (ytReady && ytPlayer) {
            ytPlayer.playVideo();
        }
    } else {
        audio.play().then(() => {
            isPlaying = true;
            updatePlayPauseUI();
            updateTrackHighlight();
        }).catch(() => {});
    }
}

function playNext() {
    if (tracks.length === 0) return;
    let next;
    if (isShuffle) {
        next = Math.floor(Math.random() * tracks.length);
        if (next === currentTrackIndex && tracks.length > 1) next = (next + 1) % tracks.length;
    } else {
        next = (currentTrackIndex + 1) % tracks.length;
    }
    currentTrackIndex = -1;
    playTrack(next);
}

function playPrev() {
    const curTime = getActiveType() === 'youtube'
        ? (ytReady && ytPlayer ? ytPlayer.getCurrentTime() : 0)
        : audio.currentTime;
    if (curTime > 3) {
        if (getActiveType() === 'youtube') { ytPlayer.seekTo(0); }
        else { audio.currentTime = 0; }
        return;
    }
    let prev = isShuffle
        ? Math.floor(Math.random() * tracks.length)
        : (currentTrackIndex - 1 + tracks.length) % tracks.length;
    currentTrackIndex = -1;
    playTrack(prev);
}

// ===== UI Updates =====
function updatePlayPauseUI() {
    $('#playIcon').style.display = isPlaying ? 'none' : 'block';
    $('#pauseIcon').style.display = isPlaying ? 'block' : 'none';
    const btn = $('#btnPlayAll');
    btn.innerHTML = isPlaying
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
}

function updateNowPlayingInfo() {
    if (currentTrackIndex < 0) return;
    const track = tracks[currentTrackIndex];
    $('#npTrackName').textContent = track.title;
    $('#npArtistName').textContent = track.artist;
    $('#npAlbumImg').src = track.cover;
    $('#npLike').classList.toggle('active', !!track.isLiked);
    document.title = `${track.title} • ${track.artist} — Vibe Player`;
}

function updateTrackHighlight() {
    $$('.track-row').forEach((row, i) => {
        row.classList.toggle('playing', i === currentTrackIndex && isPlaying);
        const numPlay = row.querySelector('.track-num-play');
        if (i === currentTrackIndex && isPlaying) {
            numPlay.innerHTML = '<div class="eq-bars"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>';
        } else {
            numPlay.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        }
    });
}

function updateBackgroundAccent(rgb) {
    $('#bgGradient').style.background = `
        radial-gradient(ellipse at 20% 0%, rgba(${rgb},0.12) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 100%, rgba(168,85,247,0.06) 0%, transparent 50%)`;
    $('.hero-gradient').style.background = `linear-gradient(180deg, rgba(${rgb},0.2) 0%, transparent 100%)`;
}

// ===== Progress Bar =====
function updateProgress() {
    if (isDraggingProgress || !audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    $('#progressBarFill').style.width = pct + '%';
    $('#progressBarHandle').style.left = pct + '%';
    $('#npCurrentTime').textContent = formatTime(audio.currentTime);
    $('#npTotalTime').textContent = formatTime(audio.duration);
}

function seekTo(e) {
    const rect = $('#progressBarContainer').getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    if (getActiveType() === 'youtube' && ytReady && ytPlayer) {
        const dur = ytPlayer.getDuration();
        ytPlayer.seekTo(pct * dur, true);
        $('#progressBarFill').style.width = (pct * 100) + '%';
        $('#progressBarHandle').style.left = (pct * 100) + '%';
        $('#npCurrentTime').textContent = formatTime(pct * dur);
    } else if (audio.duration) {
        audio.currentTime = pct * audio.duration;
        $('#progressBarFill').style.width = (pct * 100) + '%';
        $('#progressBarHandle').style.left = (pct * 100) + '%';
    }
}

$('#progressBarContainer').addEventListener('mousedown', (e) => { isDraggingProgress = true; seekTo(e); });

document.addEventListener('mousemove', (e) => {
    if (isDraggingProgress) seekTo(e);
    if (isDraggingVolume) setVolumeFromEvent(e);
});

document.addEventListener('mouseup', () => { isDraggingProgress = false; isDraggingVolume = false; });

// ===== Volume (Dual Engine) =====
function setVolumeFromEvent(e) {
    const rect = $('#volumeSliderContainer').getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setVolume(pct);
}

function setVolume(pct) {
    currentVolume = pct;
    audio.volume = pct;
    if (ytReady && ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(pct * 100);
    updateVolumeUI(pct);
}

function updateVolumeUI(pct) {
    $('#volumeSliderFill').style.width = (pct * 100) + '%';
    $('#volumeSliderHandle').style.left = (pct * 100) + '%';
    const volHigh = $('#volHigh'), volMed = $('#volMed');
    if (pct === 0) { volHigh.style.display = 'none'; volMed.style.display = 'none'; }
    else if (pct < 0.5) { volHigh.style.display = 'none'; volMed.style.display = 'block'; }
    else { volHigh.style.display = 'block'; volMed.style.display = 'block'; }
}

$('#volumeSliderContainer').addEventListener('mousedown', (e) => { isDraggingVolume = true; setVolumeFromEvent(e); });

$('#npVolume').addEventListener('click', () => {
    if (currentVolume > 0) {
        audio._prevVol = currentVolume;
        setVolume(0);
    } else {
        setVolume(audio._prevVol || 0.7);
    }
});

// ===== Audio Events =====
audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('ended', () => {
    if (repeatMode === 2) { audio.currentTime = 0; audio.play(); }
    else if (repeatMode === 1 || currentTrackIndex < tracks.length - 1 || isShuffle) { playNext(); }
    else { isPlaying = false; updatePlayPauseUI(); updateTrackHighlight(); }
});
audio.addEventListener('loadedmetadata', () => { $('#npTotalTime').textContent = formatTime(audio.duration); });

// ===== Button Events =====
$('#npPlayPause').addEventListener('click', () => {
    if (currentTrackIndex < 0) playTrack(0);
    else if (isPlaying) pausePlayback();
    else resumePlayback();
});

$('#npNext').addEventListener('click', playNext);
$('#npPrev').addEventListener('click', playPrev);

$('#btnPlayAll').addEventListener('click', () => {
    if (currentTrackIndex < 0) playTrack(0);
    else if (isPlaying) pausePlayback();
    else resumePlayback();
});

$('#npShuffle').addEventListener('click', () => {
    isShuffle = !isShuffle;
    $('#npShuffle').classList.toggle('active', isShuffle);
    $('#btnShuffle').classList.toggle('active', isShuffle);
});

$('#btnShuffle').addEventListener('click', () => {
    isShuffle = !isShuffle;
    $('#npShuffle').classList.toggle('active', isShuffle);
    $('#btnShuffle').classList.toggle('active', isShuffle);
});

$('#npRepeat').addEventListener('click', () => {
    repeatMode = (repeatMode + 1) % 3;
    const btn = $('#npRepeat');
    btn.classList.toggle('active', repeatMode > 0);
    btn.innerHTML = repeatMode === 2
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/><text x="11" y="15" fill="currentColor" stroke="none" font-size="8" font-weight="700">1</text></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>';
});

$('#npLike').addEventListener('click', function() {
    if (currentTrackIndex >= 0) {
        const track = tracks[currentTrackIndex];
        toggleLike(track.id || track.videoId);
    } else {
        this.classList.toggle('active');
    }
});

// ===== Sidebar Events =====
$('#playlistLofi').addEventListener('click', (e) => {
    e.preventDefault();
    currentPlaylist = 'lofi';
    $('#playlistLofi').classList.add('active-playlist');
    $('#playlistLiked').classList.remove('active-playlist');
    
    $('.hero-title').textContent = 'Lo-Fi Vibes';
    $('.hero-description').textContent = 'Chill beats for focus, study, and relaxation. Let the smooth melodies carry you through your day.';
    $('.hero-badge').textContent = 'PLAYLIST';
    $('.hero-badge').style.background = 'rgba(255, 255, 255, 0.2)';
    $('.hero-badge').style.color = '#fff';
    updateBackgroundAccent('168, 85, 247');
    
    renderTracks();
    updateSongCount();
});

$('#playlistLiked').addEventListener('click', (e) => {
    e.preventDefault();
    currentPlaylist = 'liked';
    $('#playlistLiked').classList.add('active-playlist');
    $('#playlistLofi').classList.remove('active-playlist');
    
    $('.hero-title').textContent = 'Liked Songs';
    $('.hero-description').textContent = 'All the tracks you have loved.';
    $('.hero-badge').textContent = 'FAVORITES';
    $('.hero-badge').style.background = 'var(--accent)';
    $('.hero-badge').style.color = '#000';
    updateBackgroundAccent('29, 185, 84');
    
    renderTracks();
    updateSongCount();
});

$('#btnCreatePlaylist').addEventListener('click', () => {
    const name = prompt('Enter a name for your new playlist:');
    if (name && name.trim()) {
        const newId = 'custom_' + Date.now();
        customPlaylists.push({
            id: newId,
            name: name.trim(),
            trackIds: []
        });
        saveCustomPlaylists();
        renderSidebarPlaylists();
    }
});

// ===== YouTube Add Events =====
$('#ytAddBtn').addEventListener('click', addYouTubeTrack);
$('#ytUrlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addYouTubeTrack();
});

// ===== Scroll Effect =====
$('#mainContent').addEventListener('scroll', function() {
    $('#topBar').classList.toggle('scrolled', this.scrollTop > 40);
});

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch(e.code) {
        case 'Space':
            e.preventDefault();
            if (currentTrackIndex < 0) playTrack(0);
            else if (isPlaying) pausePlayback();
            else resumePlayback();
            break;
        case 'ArrowRight':
            if (e.shiftKey) playNext();
            else {
                if (getActiveType() === 'youtube' && ytReady) ytPlayer.seekTo(ytPlayer.getCurrentTime() + 5, true);
                else if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
            }
            break;
        case 'ArrowLeft':
            if (e.shiftKey) playPrev();
            else {
                if (getActiveType() === 'youtube' && ytReady) ytPlayer.seekTo(Math.max(0, ytPlayer.getCurrentTime() - 5), true);
                else if (audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 5);
            }
            break;
        case 'ArrowUp':
            e.preventDefault();
            setVolume(Math.min(1, currentVolume + 0.05));
            break;
        case 'ArrowDown':
            e.preventDefault();
            setVolume(Math.max(0, currentVolume - 0.05));
            break;
    }
});

// ===== Canvas Visualizer (audio tracks only) =====
let audioCtx, analyser, source, connected = false;
let visualizerFailed = false;

function initVisualizer() {
    if (connected || visualizerFailed) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        connected = true;
        drawVisualizer();
    } catch(e) {
        console.warn("Visualizer init failed:", e);
        visualizerFailed = true;
        $('#visualizerCanvas').style.display = 'none';
    }
}

function drawVisualizer() {
    const canvas = $('#visualizerCanvas');
    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    function resize() { canvas.width = window.innerWidth; canvas.height = 60; }
    resize();
    window.addEventListener('resize', resize);
    function draw() {
        requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const barWidth = canvas.width / bufferLength * 2;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height;
            ctx.fillStyle = `hsla(${140 + (i / bufferLength) * 60}, 70%, 55%, 0.4)`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
            x += barWidth;
        }
    }
    draw();
}

audio.addEventListener('play', () => {
    if (!connected && !visualizerFailed) initVisualizer();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});

// ===== Helpers =====
function formatTime(sec) {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ===== Init =====
loadSavedData();
renderTracks();
updateVolumeUI(currentVolume);
updateSongCount();
