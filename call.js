import { db } from "./firebase.js";
import {
  doc, setDoc, updateDoc, onSnapshot,
  collection, addDoc, getDoc, deleteDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];

async function cleanupSubcollections(callRef){
  // bersihin kandidat biar tidak numpuk
  const offerCandidates = collection(callRef, "offerCandidates");
  const answerCandidates = collection(callRef, "answerCandidates");
  const oc = await getDocs(offerCandidates);
  const ac = await getDocs(answerCandidates);
  await Promise.all([
    ...oc.docs.map(d => deleteDoc(d.ref)),
    ...ac.docs.map(d => deleteDoc(d.ref)),
  ]);
}

export async function startCall({ roomId, callerName, kind, onStatus }) {
  const callRef = doc(db, "rooms", roomId, "calls", "active");
  await cleanupSubcollections(callRef);

  const offerCandidates = collection(callRef, "offerCandidates");
  const answerCandidates = collection(callRef, "answerCandidates");

  const pc = new RTCPeerConnection({ iceServers: ICE });

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: kind === "video"
  });
  stream.getTracks().forEach(t => pc.addTrack(t, stream));

  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(offerCandidates, e.candidate.toJSON());
  };

  const remoteStream = new MediaStream();
  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
  };

  const offerDesc = await pc.createOffer();
  await pc.setLocalDescription(offerDesc);

  await setDoc(callRef, {
    status: "ringing",
    kind,
    callerName,
    createdAt: Date.now(),
    offer: { type: offerDesc.type, sdp: offerDesc.sdp }
  });

  const unsubDoc = onSnapshot(callRef, async (snap) => {
    const data = snap.data();
    if (!data) return;
    if (data.status && onStatus) onStatus(data.status);

    if (data.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
    if (data.status === "ended") cleanup();
  });

  const unsubAns = onSnapshot(answerCandidates, (snap) => {
    snap.docChanges().forEach((c) => {
      if (c.type === "added") pc.addIceCandidate(new RTCIceCandidate(c.doc.data()));
    });
  });

  function cleanup() {
    unsubDoc(); unsubAns();
    try { pc.getSenders().forEach(s => s.track && s.track.stop()); } catch {}
    try { pc.close(); } catch {}
  }

  return {
    pc,
    stream,
    remoteStream,
    end: async () => {
      try { await updateDoc(callRef, { status: "ended" }); } catch {}
      cleanup();
    }
  };
}

export async function joinCall({ roomId, onStatus }) {
  const callRef = doc(db, "rooms", roomId, "calls", "active");
  const snap = await getDoc(callRef);
  if (!snap.exists()) throw new Error("Belum ada panggilan aktif.");

  const data = snap.data();
  const kind = data.kind || "voice";

  const offerCandidates = collection(callRef, "offerCandidates");
  const answerCandidates = collection(callRef, "answerCandidates");

  const pc = new RTCPeerConnection({ iceServers: ICE });

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: kind === "video"
  });
  stream.getTracks().forEach(t => pc.addTrack(t, stream));

  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(answerCandidates, e.candidate.toJSON());
  };

  const remoteStream = new MediaStream();
  pc.ontrack = (e) => {
    e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
  };

  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

  const answerDesc = await pc.createAnswer();
  await pc.setLocalDescription(answerDesc);

  await updateDoc(callRef, {
    status: "in_call",
    answer: { type: answerDesc.type, sdp: answerDesc.sdp }
  });

  const unsubDoc = onSnapshot(callRef, (snap2) => {
    const d = snap2.data();
    if (!d) return;
    if (d.status && onStatus) onStatus(d.status);
    if (d.status === "ended") cleanup();
  });

  const unsubOff = onSnapshot(offerCandidates, (snap3) => {
    snap3.docChanges().forEach((c) => {
      if (c.type === "added") pc.addIceCandidate(new RTCIceCandidate(c.doc.data()));
    });
  });

  function cleanup() {
    unsubDoc(); unsubOff();
    try { pc.getSenders().forEach(s => s.track && s.track.stop()); } catch {}
    try { pc.close(); } catch {}
  }

  return {
    pc,
    stream,
    remoteStream,
    kind,
    end: async () => {
      try { await updateDoc(callRef, { status: "ended" }); } catch {}
      cleanup();
    }
  };
}
