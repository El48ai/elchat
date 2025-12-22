import { ensureAnonAuth, db, storage, rtdb } from "./firebase.js";
import { startCall, joinCall } from "./call.js";

import {
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  ref as sRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import {
  ref as dRef, set, onValue, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const $ = (id)=>document.getElementById(id);

// UI
const nameEl = $("name");
const roomEl = $("room");
const joinBtn = $("joinBtn");
const newBtn = $("newBtn");
const copyBtn = $("copyBtn");
const mePill = $("mePill");

const chatCard = $("chatCard");
const messagesEl = $("messages");
const form = $("form");
const textEl = $("text");

const filePick = $("filePick");
const btnFile = $("btnFile");
const btnPhoto = $("btnPhoto");
const btnCam = $("btnCam");

const btnRec = $("btnRec");
const btnStop = $("btnStop");

const onlineList = $("onlineList");

const camCard = $("camCard");
const video = $("video");
const canvas = $("canvas");
const snapBtn = $("snapBtn");
const closeCamBtn = $("closeCamBtn");

// Call UI
const btnVoice = $("btnVoice");
const btnVideo = $("btnVideo");
const btnJoinCall = $("btnJoinCall");
const btnHang = $("btnHang");
const btnMute = $("btnMute");
const btnCamOff = $("btnCamOff");
const callView = $("callView");
const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");
const callStatus = $("callStatus");

// State
let myName = "";
let myRoom = "";
let uid = "";
let unsubChat = null;

let mediaRecorder = null;
let recChunks = [];
let camStream = null;

let callSession = null;
let muted = false;
let camOff = false;

// Helpers
function randRoom(){
  const a = Math.random().toString(36).slice(2,6);
  const b = Math.random().toString(36).slice(2,6);
  return `${a}-${b}`;
}
function esc(s){
  return (s||"").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function scrollBottom(){ messagesEl.scrollTop = messagesEl.scrollHeight; }
function formatBytes(bytes){
  const units = ["B","KB","MB","GB"];
  let i=0, n=bytes;
  while(n>=1024 && i<units.length-1){ n/=1024; i++; }
  return `${n.toFixed(n<10 && i>0 ? 1 : 0)} ${units[i]}`;
}

function setRoomFromURL(){
  const u = new URL(location.href);
  const r = u.searchParams.get("room");
  if (r) roomEl.value = r;
}
setRoomFromURL();

newBtn.onclick = ()=>{
  roomEl.value = randRoom();
};

copyBtn.onclick = async ()=>{
  const u = new URL(location.href);
  const r = (roomEl.value||"").trim().toLowerCase();
  if (r) u.searchParams.set("room", r);
  try{
    await navigator.clipboard.writeText(u.toString());
    copyBtn.textContent = "Tersalin ✅";
    setTimeout(()=>copyBtn.textContent="Salin Link", 1200);
  }catch{
    alert("Gagal copy. Copy manual dari address bar.");
  }
};

function renderMsg(m){
  const isMe = m.uid === uid;
  const div = document.createElement("div");
  div.className = "bubble" + (isMe ? " me" : "");
  const t = m.createdAt?.toDate ? m.createdAt.toDate() : null;
  const time = t ? t.toLocaleString("id-ID",{hour:"2-digit",minute:"2-digit"}) : "";

  let body = "";
  if (m.type === "text"){
    body = `<div class="msgText">${esc(m.text)}</div>`;
  } else if (m.type === "image"){
    body = `
      <div class="msgText">${esc(m.caption || "")}</div>
      <div style="margin-top:8px">
        <img src="${esc(m.url)}" alt="foto"
             style="max-width:100%;border-radius:12px;border:1px solid rgba(160,190,255,.18)">
      </div>`;
  } else if (m.type === "file"){
    body = `
      <div class="msgText">📎 ${esc(m.fileName)} (${esc(m.sizeText)})</div>
      <div style="margin-top:8px">
        <a href="${esc(m.url)}" target="_blank" rel="noreferrer">Download file</a>
      </div>`;
  } else if (m.type === "voice"){
    body = `
      <div class="msgText">🎙️ Voice note</div>
      <div style="margin-top:8px">
        <audio controls src="${esc(m.url)}" style="width:100%"></audio>
      </div>`;
  }

  div.innerHTML = `
    <div class="meta">${esc(m.name)} • ${esc(time)}</div>
    ${body}
  `;
  messagesEl.appendChild(div);
}

async function setupPresence(){
  const userRef = dRef(rtdb, `presence/${myRoom}/${uid}`);
  await set(userRef, { name: myName, state:"online", ts: Date.now() });
  await onDisconnect(userRef).set({ name: myName, state:"offline", ts: Date.now() });

  const roomPresenceRef = dRef(rtdb, `presence/${myRoom}`);
  onValue(roomPresenceRef, (snap)=>{
    const data = snap.val() || {};
    onlineList.innerHTML = "";
    Object.values(data)
      .filter(v => v && v.state === "online")
      .forEach(v=>{
        const b = document.createElement("div");
        b.className = "badge";
        b.textContent = v.name || "Anon";
        onlineList.appendChild(b);
      });
  });
}

function showCallUI(show){
  callView.classList.toggle("hidden", !show);
  btnHang.classList.toggle("hidden", !show);
  btnMute.classList.toggle("hidden", !show);
  btnCamOff.classList.toggle("hidden", !show);

  // saat call aktif, tombol start/join masih boleh, tapi biar rapi kita disable
  btnVoice.disabled = show;
  btnVideo.disabled = show;
  btnJoinCall.disabled = show;
}

function setCallStatus(text){
  callStatus.textContent = text || "";
}

async function joinRoom(){
  myName = (nameEl.value||"").trim();
  myRoom = (roomEl.value||"").trim().toLowerCase();
  if (!myName) return alert("Isi nama dulu ya.");
  if (!myRoom) return alert("Isi kode room dulu ya.");

  const user = await ensureAnonAuth();
  uid = user.uid;

  const u = new URL(location.href);
  u.searchParams.set("room", myRoom);
  history.replaceState({}, "", u.toString());

  mePill.textContent = "Online";
  chatCard.classList.remove("hidden");

  await setupPresence();

  // listen chat
  if (unsubChat) unsubChat();
  const colRef = collection(db, "rooms", myRoom, "messages");
  const q = query(colRef, orderBy("createdAt","asc"));
  messagesEl.innerHTML = "";

  unsubChat = onSnapshot(q, (snap)=>{
    messagesEl.innerHTML = "";
    snap.forEach(d => renderMsg(d.data()));
    scrollBottom();
  });

  // send text
  form.onsubmit = async (e)=>{
    e.preventDefault();
    const text = (textEl.value||"").trim();
    if (!text) return;
    textEl.value = "";
    await addDoc(colRef, {
      type:"text",
      text,
      name: myName,
      uid,
      createdAt: serverTimestamp()
    });
  };

  // file/photo picker
  btnFile.onclick = ()=>{
    filePick.accept = "*/*";
    filePick.click();
  };
  btnPhoto.onclick = ()=>{
    filePick.accept = "image/*";
    filePick.click();
  };
  filePick.onchange = async ()=>{
    const f = filePick.files?.[0];
    filePick.value = "";
    if (!f) return;
    if ((f.type||"").startsWith("image/")) {
      await uploadAndSendImage(f, colRef, "Foto");
    } else {
      await uploadAndSendFile(f, colRef);
    }
  };

  // camera
  btnCam.onclick = openCamera;
  closeCamBtn.onclick = closeCamera;
  snapBtn.onclick = async ()=>{
    const blob = await snapPhoto();
    if (!blob) return;
    const file = new File([blob], `camera_${Date.now()}.jpg`, { type:"image/jpeg" });
    await uploadAndSendImage(file, colRef, "Foto dari kamera");
    closeCamera();
  };

  // voice note record
  btnRec.onclick = async ()=>startRecording(colRef);
  btnStop.onclick = async ()=>stopRecording(colRef);

  // Call buttons
  btnVoice.onclick = async ()=>{
    try{
      setCallStatus("Memulai voice call...");
      callSession = await startCall({
        roomId: myRoom,
        callerName: myName,
        kind: "voice",
        onStatus: (s)=>setCallStatus(`Status: ${s}`)
      });
      localVideo.srcObject = callSession.stream; // video kosong untuk voice, tapi aman
      remoteVideo.srcObject = callSession.remoteStream;
      muted = false; camOff = false;
      btnMute.textContent = "🔇 Mute";
      btnCamOff.textContent = "🚫 Cam";
      showCallUI(true);
      setCallStatus("Menunggu teman join (klik Join Call di HP teman).");
    }catch(e){
      console.error(e);
      alert("Gagal mulai call. Pastikan izin mic & HTTPS.");
      setCallStatus("");
    }
  };

  btnVideo.onclick = async ()=>{
    try{
      setCallStatus("Memulai video call...");
      callSession = await startCall({
        roomId: myRoom,
        callerName: myName,
        kind: "video",
        onStatus: (s)=>setCallStatus(`Status: ${s}`)
      });
      localVideo.srcObject = callSession.stream;
      remoteVideo.srcObject = callSession.remoteStream;
      muted = false; camOff = false;
      btnMute.textContent = "🔇 Mute";
      btnCamOff.textContent = "🚫 Cam";
      showCallUI(true);
      setCallStatus("Menunggu teman join (klik Join Call di HP teman).");
    }catch(e){
      console.error(e);
      alert("Gagal mulai video call. Pastikan izin kamera/mic & HTTPS.");
      setCallStatus("");
    }
  };

  btnJoinCall.onclick = async ()=>{
    try{
      setCallStatus("Join call...");
      callSession = await joinCall({
        roomId: myRoom,
        onStatus: (s)=>setCallStatus(`Status: ${s}`)
      });
      localVideo.srcObject = callSession.stream;
      remoteVideo.srcObject = callSession.remoteStream;
      muted = false; camOff = false;
      btnMute.textContent = "🔇 Mute";
      btnCamOff.textContent = "🚫 Cam";
      showCallUI(true);
      setCallStatus("Terhubung.");
    }catch(e){
      console.error(e);
      alert("Belum ada panggilan aktif atau gagal join.");
      setCallStatus("");
    }
  };

  btnHang.onclick = async ()=>{
    if (!callSession) return;
    try{
      await callSession.end();
    }catch{}
    callSession = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    showCallUI(false);
    setCallStatus("");
  };

  btnMute.onclick = ()=>{
    if (!callSession) return;
    muted = !muted;
    callSession.stream.getAudioTracks().forEach(t=>t.enabled = !muted);
    btnMute.textContent = muted ? "🔊 Unmute" : "🔇 Mute";
  };

  btnCamOff.onclick = ()=>{
    if (!callSession) return;
    camOff = !camOff;
    callSession.stream.getVideoTracks().forEach(t=>t.enabled = !camOff);
    btnCamOff.textContent = camOff ? "🎥 Cam On" : "🚫 Cam";
  };
}

joinBtn.onclick = joinRoom;

// Upload helpers
async function uploadAndSendFile(file, colRef){
  const safeName = (file.name || "file").replace(/[^\w.\-]+/g, "_");
  const path = `uploads/${myRoom}/${uid}_${Date.now()}_${safeName}`;
  const storageRef = sRef(storage, path);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  await addDoc(colRef, {
    type: "file",
    url,
    fileName: file.name || "file",
    sizeText: formatBytes(file.size || 0),
    mime: file.type || "application/octet-stream",
    name: myName,
    uid,
    createdAt: serverTimestamp()
  });
}

async function uploadAndSendImage(file, colRef, caption=""){
  const safeName = (file.name || "image").replace(/[^\w.\-]+/g, "_");
  const path = `uploads/${myRoom}/${uid}_${Date.now()}_${safeName}`;
  const storageRef = sRef(storage, path);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  await addDoc(colRef, {
    type:"image",
    url,
    caption,
    name: myName,
    uid,
    createdAt: serverTimestamp()
  });
}

// Camera
async function openCamera(){
  try{
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:"user" }, audio:false });
    video.srcObject = camStream;
    camCard.classList.remove("hidden");
  }catch(e){
    console.error(e);
    alert("Kamera tidak bisa dibuka. Pastikan HTTPS & izin kamera.");
  }
}
function closeCamera(){
  camCard.classList.add("hidden");
  if (camStream){
    camStream.getTracks().forEach(t=>t.stop());
    camStream = null;
  }
}
async function snapPhoto(){
  if (!video.videoWidth) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, w, h);
  return await new Promise(res=>canvas.toBlob(res, "image/jpeg", 0.9));
}

// Voice note
async function startRecording(colRef){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    recChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

    mediaRecorder.ondataavailable = (e)=>{ if (e.data.size) recChunks.push(e.data); };
    mediaRecorder.onstop = ()=> stream.getTracks().forEach(t=>t.stop());
    mediaRecorder.start();

    btnRec.classList.add("hidden");
    btnStop.classList.remove("hidden");
  }catch(e){
    console.error(e);
    alert("Mic tidak bisa dipakai. Pastikan HTTPS & izin mikrofon.");
  }
}

async function stopRecording(colRef){
  if (!mediaRecorder) return;
  mediaRecorder.stop();

  btnStop.classList.add("hidden");
  btnRec.classList.remove("hidden");

  const blob = new Blob(recChunks, { type:"audio/webm" });
  const file = new File([blob], `voice_${Date.now()}.webm`, { type:"audio/webm" });

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `uploads/${myRoom}/${uid}_${Date.now()}_${safeName}`;
  const storageRef = sRef(storage, path);

  await uploadBytes(storageRef, file);
  const url = await getDownloadURL(storageRef);

  await addDoc(colRef, {
    type:"voice",
    url,
    name: myName,
    uid,
    createdAt: serverTimestamp()
  });

  mediaRecorder = null;
}

// PWA Service Worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
