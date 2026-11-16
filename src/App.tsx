import { useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Activity, ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, Heart, Home, LockKeyhole, MessageCircleHeart, ShieldAlert, Sparkles, Star, Users, X } from 'lucide-react';

type Phase = { name: string; tag: string; emoji: string; color: string; title: string; body: string; care: string };
type Admission = { state: 'connecting' | 'active' | 'waiting' | 'offline' | 'unauthenticated'; position?: number; active?: number; limit?: number };
type PlayerAccount = { id: string; username: string; progress: { stars: number; completed: string[]; avatar: number } };
const phases: Phase[] = [
  { name: 'Menstrual', tag: 'Phase 1', emoji: '🌧️', color: 'rose', title: 'A reset, not a setback', body: 'The uterine lining sheds. Bleeding is a normal part of many menstrual cycles; flow and feelings can vary from person to person.', care: 'Rest if you want to, hydrate, use period products that feel right, and ask a trusted adult or health professional about pain that disrupts your day.' },
  { name: 'Follicular', tag: 'Phase 2', emoji: '🌱', color: 'green', title: 'A little more spring', body: 'The body prepares an egg and the uterine lining begins to build again. This phase starts on the first day of a period and continues toward ovulation.', care: 'Notice what feels good for you. There is no “correct” energy level or mood for this phase.' },
  { name: 'Ovulation', tag: 'Phase 3', emoji: '☀️', color: 'yellow', title: 'An egg may be released', body: 'Around ovulation, an ovary may release an egg. Cycle timing varies, especially during the teen years, and apps are only estimates.', care: 'Your body is yours in every phase. Knowing your cycle never creates an obligation to anyone else.' },
  { name: 'Luteal', tag: 'Phase 4', emoji: '🍂', color: 'purple', title: 'A softer landing', body: 'After ovulation, hormones shift as the body gets ready for the next period. Some people notice changes in mood, skin, appetite, or energy; others do not.', care: 'Gentle routines can help. If symptoms worry you, talk with a trusted adult or healthcare professional.' },
];
const scenarios = [
  { label: 'Social pressure', icon: '👯', title: '“Everyone else is going. Don’t be boring!”', prompt: 'Your friends are pushing you to go somewhere you do not feel comfortable. What feels most like you?', choices: [ ['🧭', 'Check in with myself and choose what feels safe.', 'You noticed your own signal. You can say “not today” and suggest another plan.'], ['💬', 'Tell a friend I trust and make a plan together.', 'A trusted buddy can make it easier to hold a boundary. Your choice still belongs to you.'], ['🫧', 'Pause, get more information, then decide.', 'You do not owe anyone an instant answer. Taking time is a strong choice.'] ] },
  { label: 'Social media', icon: '📱', title: 'A post makes you compare your body to someone else’s.', prompt: 'What could help you feel more grounded?', choices: [ ['🌿', 'Take a screen break and follow accounts that feel kind.', 'Curating your feed is a real boundary. Bodies grow and change at different paces.'], ['🪞', 'Name one thing my body helps me do.', 'You shifted attention from comparison to appreciation. That is a sharp reset.'], ['🤝', 'Talk it out with a trusted person.', 'You do not have to carry a tough feeling alone. Asking for support is strength.'] ] },
  { label: 'Lifestyle pressure', icon: '⚡', title: 'Your week is packed and you are running low.', prompt: 'What is a kind next step?', choices: [ ['🛌', 'Choose one priority and protect some rest.', 'Rest is not something you have to earn. Making room to recharge is self-care.'], ['🗓️', 'Ask for help rearranging my plans.', 'Sharing the load is a smart strategy, not a failure.'], ['💧', 'Take a small reset: water, a snack, or a quiet minute.', 'Small body check-ins can help you decide what you need next.'] ] },
  { label: 'Friend pressure', icon: '🗣️', title: 'A friend wants you to share someone else’s private story.', prompt: 'How can you protect trust?', choices: [ ['🔒', 'Keep it private and say I will not pass it on.', 'You protected someone’s trust. Private stories are not group entertainment.'], ['🧡', 'Encourage my friend to ask the person directly.', 'You redirected the conversation with care and respect.'], ['🧑‍🏫', 'If someone may be unsafe, tell a trusted adult.', 'Safety comes first. Getting help is caring, not gossip.'] ] },
  { label: 'Boundaries', icon: '🛑', title: 'Someone keeps asking after you already said no.', prompt: 'What is a clear, safe response?', choices: [ ['✋', 'Repeat “No. I’m not comfortable.” and leave if I can.', 'A no is enough. You do not need to explain or negotiate your boundary.'], ['📲', 'Contact someone I trust and move to a safer place.', 'Your safety matters. A buddy or trusted adult can help you get support.'], ['🧠', 'Remember: pressure is not permission.', 'Exactly. Respect means accepting a no without pushing, guilt, or threats.'] ] },
];
const gbvCases = [
  { place: 'A FRIENDSHIP THAT FEELS DIFFERENT', icon: '📱', title: '“Share your password if you trust me”', scene: 'A classmate says a partner keeps asking for phone passwords, checks messages, and gets upset when they spend time with friends. Your classmate asks if this is normal.', signalQuestion: 'Which pattern is a warning sign?', signals: [ ['🧭','Respecting a no and private space'], ['🔎','Repeated monitoring and pressure to give up privacy'], ['🌿','Choosing to spend time with different friends sometimes'] ], signalAnswer: 1, signalFeedback: 'Repeated monitoring, pressure, and isolation can be controlling behaviors. One detail alone may not tell the whole story, but nobody owes anyone passwords or constant access.', responses: [ ['👂','Listen privately, believe them, and ask what support they want.','You centered your classmate and let them choose what feels safe.'], ['🧑‍🏫','Offer to talk with a trusted adult or school counselor together.','You offered support and a trusted adult without taking control.'], ['🛡️','If they feel in immediate danger, help them reach a safe adult or local emergency support.','Safety comes first. You do not have to handle a risky situation alone.'] ] },
  { place: 'AT SCHOOL', icon: '🏫', title: 'The “joke” that keeps targeting her', scene: 'A group repeatedly makes gender-based comments at a student, even after she says they bother her. A friend asks what a bystander could do safely.', signalQuestion: 'What matters most in spotting harassment?', signals: [ ['🧡','The comments keep targeting someone and continue after they ask for it to stop'], ['🎭','Everyone laughs, so it must be harmless'], ['🫥','The person being targeted should just ignore it'] ], signalAnswer: 0, signalFeedback: 'Repeated unwanted targeting can be harassment. A laugh or a “joke” label does not make it okay, and it is not the targeted person’s fault.', responses: [ ['🤝','Check in privately and ask what support they want.','You offered care without making them explain in public.'], ['🧑‍🏫','Tell a trusted school adult, especially if it keeps happening or feels unsafe.','Getting help is a strong bystander move; you do not need to confront anyone alone.'], ['🗣️','If it feels safe, calmly say the comments are not okay, then get support.','A small interruption can help, but your safety matters—get an adult if the situation escalates.'] ] },
  { place: 'IN A GROUP CHAT', icon: '💬', title: 'Someone says a private image is being shared', scene: 'A friend tells you someone is threatening to share a private image of them. You do not need to see or describe the image. Your friend looks worried and asks for help.', signalQuestion: 'What is the key thing to remember?', signals: [ ['📩','Forward it to trusted friends to check what happened'], ['🛑','Do not ask to see or forward it; get trusted adult support'], ['🙈','It is their fault for taking or sharing anything'] ], signalAnswer: 1, signalFeedback: 'Threatening or sharing private images without consent is harmful and not the person’s fault. Do not request, save, or forward the image. Involve a trusted adult promptly.', responses: [ ['🫶','Listen, reassure them it is not their fault, and ask what feels safe now.','You gave support without blame or pressure.'], ['🧑‍🏫','Help them reach a trusted adult, counselor, or local child-safety support service.','You connected them with people who can help protect their safety and privacy.'], ['🚨','If there is immediate danger, contact a safe adult or local emergency services.','Urgent danger needs real-world help. You should not manage it alone.'] ] },
];
const trailSteps = [
  { place: 'THE SCHOOL COURTYARD', emoji: '🏫', title: 'The quiet corner', scene: 'A classmate sits alone at lunch, looking uncomfortable while a group nearby jokes about periods. The bell rings in five minutes. What do you do first?', choices: [
    { emoji: '👋', label: 'Ask privately, “Want company or some space?”', result: 'You checked in without making them the center of attention. They choose a quiet walk together.', clue: 'A private, kind check-in offers choice.' },
    { emoji: '📣', label: 'Call across the courtyard and ask what is wrong.', result: 'Your concern is real, but a public question can feel exposing. You notice and try a quieter check-in.', clue: 'Privacy can help someone feel safer.' },
    { emoji: '🧑‍🏫', label: 'Find a trusted school adult if they seem unsafe.', result: 'You brought in support when safety might be involved. A trusted adult can help without leaving them alone.', clue: 'Adults can help when safety is uncertain.' },
  ], best: 0 },
  { place: 'THE GROUP CHAT', emoji: '📱', title: 'A screenshot is going around', scene: 'Friends are sharing a private screenshot and adding mean comments. One person asks you to forward it. What is your next move?', choices: [
    { emoji: '🛑', label: 'Do not forward it; ask for the sharing to stop.', result: 'You refused to spread private content and set a clear boundary.', clue: 'Do not forward private or humiliating content.' },
    { emoji: '📲', label: 'Send it to more friends so they can decide.', result: 'More sharing can increase harm. You pause, stop forwarding, and ask the group to delete it.', clue: 'More viewers usually means more harm.' },
    { emoji: '🧑‍🤝‍🧑', label: 'Check privately with the person targeted and ask what help they want.', result: 'You centered the person affected and offered support without taking control.', clue: 'Ask what support the affected person wants.' },
  ], best: 0 },
  { place: 'THE WALK HOME', emoji: '🌇', title: 'Pressure to say yes', scene: 'Someone keeps pushing after your friend said “no thanks.” Your friend looks unsure. What is a helpful buddy move?', choices: [
    { emoji: '🤝', label: 'Check with your friend and offer to leave together.', result: 'You supported their choice and offered a practical way to step away.', clue: 'A buddy can support a safe exit.' },
    { emoji: '🗣️', label: 'Tell the person to stop, if it feels safe to do so.', result: 'You named the boundary. If the situation escalates, move away and find trusted help.', clue: 'Respect a no; seek help if pressure continues.' },
    { emoji: '📞', label: 'Call a trusted adult if anyone may be unsafe.', result: 'You recognized when extra support may be needed. Safety matters more than handling it alone.', clue: 'Trusted adults are part of a safety plan.' },
  ], best: 0 },
];
const avatars = [{ face: '👩🏽‍🚀', name: 'Mika' }, { face: '👩🏻‍🎨', name: 'Tori' }, { face: '👩🏿‍🔬', name: 'Sam' }, { face: '🧑🏼‍🎤', name: 'Alex' }];

export default function App() {
  const [section, setSection] = useState('home');
  const [avatar, setAvatar] = useState(0);
  const [phase, setPhase] = useState(0);
  const [scenario, setScenario] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [stars, setStars] = useState(3);
  const [completed, setCompleted] = useState<string[]>([]);
  const [mode, setMode] = useState<'solo' | 'group'>('solo');
  const [sequence, setSequence] = useState<number[]>([]);
  const [admission, setAdmission] = useState<Admission>({ state: 'connecting' });
  const [showRules, setShowRules] = useState(false);
  const [groupInfo, setGroupInfo] = useState<{ status: 'idle' | 'waiting' | 'matched'; votes: number[] }>({ status: 'idle', votes: [0, 0, 0] });
  const [account, setAccount] = useState<PlayerAccount | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [authMessage, setAuthMessage] = useState('');
  const [storageMode, setStorageMode] = useState<'persistent' | 'temporary' | null>(null);
  const [trailStep, setTrailStep] = useState(0);
  const [trailChoice, setTrailChoice] = useState<number | null>(null);
  const [trailClues, setTrailClues] = useState<string[]>([]);
  const [gbvStep, setGbvStep] = useState(0);
  const [gbvStage, setGbvStage] = useState<'spot' | 'support' | 'recap'>('spot');
  const [gbvChoice, setGbvChoice] = useState<number | null>(null);
  const [gbvClues, setGbvClues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const progressRef = useRef({ stars, completed, avatar });

  useEffect(() => { progressRef.current = { stars, completed, avatar }; }, [stars, completed, avatar]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { credentials: 'include' }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { account: PlayerAccount; storage: 'persistent' | 'temporary' };
      if (cancelled) return;
      setAccount(data.account); setStars(data.account.progress.stars); setCompleted(data.account.progress.completed);
      setAvatar(data.account.progress.avatar); setStorageMode(data.storage);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let socket: Socket | undefined;
    try {
      socket = io({ transports: ['websocket', 'polling'], reconnectionAttempts: 2, timeout: 3500 });
      socketRef.current = socket;
      socket.on('admission', (update: Admission) => setAdmission(update));
      socket.on('queue:position', (update: Admission) => setAdmission(update));
      socket.on('admission:promoted', (update: Admission) => setAdmission(update));
      socket.on('group:waiting', () => setGroupInfo((info) => ({ ...info, status: 'waiting' })));
      socket.on('group:matched', () => setGroupInfo((info) => ({ ...info, status: 'matched' })));
      socket.on('group:voteCounts', (votes: number[]) => setGroupInfo((info) => ({ ...info, votes })));
      socket.on('connect_error', (error) => {
        if (error.message === 'sign-in-required') {
          setAdmission({ state: 'unauthenticated' });
          setAccount(null);
          setAuthMode('register');
          setAuthOpen(true);
        } else setAdmission({ state: 'offline' });
      });
      socket.on('disconnect', () => setAdmission((current) => current.state === 'active' ? { state: 'offline' } : current));
    } catch { setAdmission({ state: 'offline' }); }
    return () => { socketRef.current = null; socket?.disconnect(); };
  }, []);

  const unlocked = admission.state === 'active' || admission.state === 'offline';
  const currentScenario = scenarios[scenario];
  const puzzleOrder = useMemo(() => [0, 1, 2, 3], []);
  const chooseScenario = (index: number) => { setChoice(index); setStars((value) => Math.min(value + 1, 99)); };
  const finishScenario = () => {
    setCompleted((done) => done.includes('boundaries') ? done : [...done, 'boundaries']);
    setChoice(null);
    setScenario((value) => (value + 1) % scenarios.length);
  };
  const selectSequence = (index: number) => {
    if (sequence.includes(index)) return;
    const next = [...sequence, index]; setSequence(next);
    if (next.length === 4) {
      if (next.every((item, position) => item === puzzleOrder[position])) setStars((value) => Math.min(value + 2, 99));
    }
  };
  const saveProgress = async (next = progressRef.current) => {
    if (!account) return;
    setSaving(true);
    try {
      const response = await fetch('/api/progress', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ progress: next }) });
      if (response.ok) { const result = await response.json() as { account: PlayerAccount }; setAccount(result.account); }
    } catch { setAuthMessage('Progress sync is temporarily unavailable. Your current session is still playable.'); }
    finally { setSaving(false); }
  };
  useEffect(() => { if (account) void saveProgress({ stars, completed, avatar }); }, [stars, completed, avatar, account?.id]);
  const submitAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setAuthMessage('');
    const form = new FormData(event.currentTarget);
    const username = String(form.get('username') ?? ''); const password = String(form.get('password') ?? '');
    try {
      const response = await fetch(`/api/auth/${authMode}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const data = await response.json() as { account?: PlayerAccount; storage?: 'persistent' | 'temporary'; error?: string };
      if (!response.ok || !data.account) { setAuthMessage(data.error ?? 'Could not sign in right now.'); return; }
      setAccount(data.account); setStars(data.account.progress.stars); setCompleted(data.account.progress.completed); setAvatar(data.account.progress.avatar);
      setStorageMode(data.storage ?? 'temporary'); setAuthOpen(false); setAuthMessage('');
      socketRef.current?.disconnect(); socketRef.current?.connect();
    } catch { setAuthMessage('Could not reach Buddie. Check the connection and try again.'); }
  };
  const logout = async () => { await saveProgress(); socketRef.current?.disconnect(); await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined); setAccount(null); setStorageMode(null); setAdmission({ state: 'unauthenticated' }); };
  const chooseTrail = (index: number) => {
    if (trailChoice !== null) return;
    const clue = trailSteps[trailStep].choices[index].clue;
    setTrailChoice(index); setTrailClues((items) => [...items, clue]);
    if (index === trailSteps[trailStep].best) setStars((value) => Math.min(value + 1, 99));
  };
  const advanceTrail = () => {
    if (trailStep === trailSteps.length - 1) {
      setCompleted((done) => [...new Set([...done, 'trail-school', 'trail-feed', 'trail-buddy'])]);
      setTrailClues([]); setTrailStep(0); setTrailChoice(null); setSection('home');
      return;
    }
    setTrailChoice(null); setTrailStep((step) => step + 1);
  };
  const chooseGbvSignal = (index: number) => {
    if (gbvChoice !== null) return;
    const item = gbvCases[gbvStep];
    setGbvChoice(index);
    setGbvClues((clues) => [...clues, item.signalFeedback]);
    if (index === item.signalAnswer) setStars((value) => Math.min(value + 1, 99));
  };
  const chooseGbvSupport = (index: number) => {
    if (gbvChoice !== null) return;
    setGbvChoice(index);
    setGbvClues((clues) => [...clues, `Support option practiced: ${gbvCases[gbvStep].responses[index][0]} ${gbvCases[gbvStep].responses[index][1]}`]);
  };
  const continueGbv = () => {
    if (gbvStage === 'spot') { setGbvChoice(null); setGbvStage('support'); return; }
    if (gbvStep === gbvCases.length - 1) {
      setCompleted((done) => done.includes('gbv') ? done : [...done, 'gbv']);
      setGbvStage('recap'); return;
    }
    setGbvStep((step) => step + 1); setGbvChoice(null); setGbvStage('spot');
  };
  const replayGbv = () => { setGbvStep(0); setGbvChoice(null); setGbvClues([]); setGbvStage('spot'); };
  const leaveGbv = () => { setSection('home'); setGbvStage('spot'); setGbvChoice(null); setGbvClues([]); setGbvStep(0); };

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setSection('home')} aria-label="Buddie home"><span className="brand-mark">b<span>✦</span></span><span>buddie<span className="brand-dot">.</span></span></button>
      <div className="side-label">YOUR LITTLE WORLD</div>
      <nav className="nav-list" aria-label="Main navigation">
        <NavButton active={section === 'home'} icon={<Home size={18}/>} label="My space" onClick={() => setSection('home')} />
        <NavButton active={section === 'cycle'} icon={<Activity size={18}/>} label="Body basics" onClick={() => setSection('cycle')} />
        <NavButton active={section === 'boundaries'} icon={<Heart size={18}/>} label="Your boundaries" onClick={() => setSection('boundaries')} />
        <NavButton active={section === 'gbv'} icon={<ShieldAlert size={18}/>} label="Safety & respect" onClick={() => setSection('gbv')} />
        <NavButton active={section === 'brain'} icon={<Sparkles size={18}/>} label="Brain break" onClick={() => setSection('brain')} />
      </nav>
      <div className="side-label journeys-label">YOUR JOURNEY</div>
      <button className="journey-card" onClick={() => setSection('cycle')}><span className="journey-icon peach">🌸</span><span><b>Body, decoded</b><small>Chapter 01 · 4 min</small></span><ArrowRight size={16}/></button>
      <button className="journey-card" onClick={() => setSection('boundaries')}><span className="journey-icon lilac">🦋</span><span><b>My rules, my rhythm</b><small>Chapter 02 · 6 min</small></span><LockKeyhole size={15}/></button>
      <div className="sidebar-bottom"><div className="buddy-note"><span>💌</span><p><b>A note for you</b><br/>You get to grow at your own pace.</p></div><button className="profile-mini" onClick={() => setAvatar((avatar + 1) % avatars.length)}><span className="mini-avatar">{avatars[avatar].face}</span><span><b>{avatars[avatar].name}</b><small>Tap to switch buddy</small></span><ChevronDown size={16}/></button></div>
    </aside>

    <main className={`main-area ${unlocked ? '' : 'game-locked'}`}>
      <header className="topbar"><div className="crumb">My space <span>/</span> <b>{sectionTitle(section)}</b></div><div className="top-actions"><button className="quiet-icon" onClick={() => setShowRules(true)} aria-label="Game guide"><CircleHelp size={19}/></button><div className="star-pill"><span>⭐</span><b>{stars}</b><small>stars</small></div>{account ? <button className="account-chip" onClick={() => void logout()} title="Sign out">{account.username}<small>{saving ? 'Saving…' : 'Sign out'}</small></button> : <button className="account-signin" onClick={() => {setAuthMode('login');setAuthOpen(true);}}>Sign in</button>}<button className="top-avatar" onClick={() => setAvatar((avatar + 1) % avatars.length)} aria-label="Change avatar">{avatars[avatar].face}</button></div></header>
      {storageMode === 'temporary' && account && <div className="storage-note">Your account is stored temporarily in this local demo. Set up PostgreSQL before publishing so accounts and progress persist.</div>}
      {admission.state === 'waiting' && <div className="queue-banner"><span className="queue-pulse"/><div><b>You’re in the Buddie waiting nook</b><span>Our play room is full right now. You’re safely in line — we’ll let you in as soon as a spot opens{admission.position ? ` (about ${admission.position} ahead)` : ''}.</span></div><span className="queue-number">#{admission.position ?? '…'}</span></div>}
      {admission.state === 'unauthenticated' && <div className="offline-banner"><span>🔐</span><span>Create an account or sign in to join the live play room.</span></div>}
      {admission.state === 'offline' && <div className="offline-banner"><span>☁️</span><span>Playing in preview mode. Multiplayer capacity protection connects when the game server is running.</span></div>}
      {admission.state === 'connecting' && <div className="offline-banner"><span>✨</span><span>Finding your place in the Buddie play room…</span></div>}
      {!unlocked && <div className="locked-overlay" aria-live="polite">{admission.state === 'unauthenticated' ? 'Sign in to enter the Buddie play room.' : 'Your game will be ready when it’s your turn in line.'}</div>}
      {section === 'home' && <HomePage avatar={avatars[avatar]} stars={stars} completed={completed} setSection={setSection} mode={mode} setMode={setMode} admission={admission} groupInfo={groupInfo} onJoinGroup={() => socketRef.current?.emit('group:join')} onGroupVote={(value) => socketRef.current?.emit('group:vote', value)} onTrail={() => setSection('trail')} onGbv={() => {replayGbv();setSection('gbv');}} onAccount={() => {setAuthMode('register');setAuthOpen(true);}} account={account}/>}
      {section === 'cycle' && <section className="content-panel"><PageHeading eyebrow="CHAPTER 01 · BODY, DECODED" title="The wonderful you" subtitle="A tiny tour of the menstrual cycle. Every body is different, and your own rhythm is yours to learn." emoji="🌷"/><div className="cycle-layout"><div className="cycle-wheel" aria-label="Four phases in a menstrual cycle"><div className="wheel-center"><span>🌙</span><b>Your<br/>cycle</b><small>your pace</small></div>{phases.map((item, index) => <button key={item.name} className={`wheel-phase wheel-${index} ${phase === index ? 'selected' : ''}`} onClick={() => {setPhase(index);if(index===3)setCompleted((done)=>done.includes('body-basics')?done:[...done,'body-basics']);}} aria-label={`${item.tag}: ${item.name}`}><span>{item.emoji}</span><small>{item.name}</small></button>)}</div><div className="phase-details"><div className={`phase-kicker ${phases[phase].color}`}>{phases[phase].tag} <span>•</span> {phases[phase].name.toUpperCase()}</div><h2>{phases[phase].title}</h2><p>{phases[phase].body}</p><div className="care-card"><span>🫶</span><div><b>Show up for you</b><p>{phases[phase].care}</p></div></div><div className="phase-controls"><button className="outline-btn" onClick={() => setPhase((phase + 3) % 4)}><ArrowLeft size={16}/> Previous</button><button className="primary-btn small" onClick={() => {const next=(phase+1)%4;setPhase(next);if(next===3)setCompleted((done)=>done.includes('body-basics')?done:[...done,'body-basics']);}}>Next phase <ArrowRight size={16}/></button></div></div></div><div className="did-you-know"><span>💡</span><p><b>Good to know</b> Cycle length and timing can vary, and periods may be irregular in the first few years. This game is for learning—not diagnosis. A trusted adult or health professional can help with questions.</p></div></section>}
      {section === 'boundaries' && <section className="content-panel"><PageHeading eyebrow="CHAPTER 02 · YOUR RULES, YOUR RHYTHM" title="Peace over pressure" subtitle="Real life can get loud. Practice listening to yourself, setting a boundary, and finding a buddy when you need one." emoji="🦋"/><div className="scenario-progress"><span>SCENARIO {scenario + 1} OF {scenarios.length}</span><div className="progress-track"><i style={{ width: `${((scenario + 1) / scenarios.length) * 100}%` }}/></div><span>{completed.length} cleared</span></div><div className="scenario-card"><div className="scenario-head"><span className="scenario-icon">{currentScenario.icon}</span><div><div className="scenario-tag">{currentScenario.label}</div><h2>{currentScenario.title}</h2></div><span className="chapter-badge">PAUSE • THINK • CHOOSE</span></div><p className="scenario-prompt">{currentScenario.prompt}</p><div className="choice-list">{currentScenario.choices.map(([emoji, text], index) => <button key={text} className={`choice-option ${choice === index ? 'chosen' : ''}`} onClick={() => chooseScenario(index)}><span className="choice-emoji">{emoji}</span><span>{text}</span><span className="choice-check">{choice === index ? <Check size={17}/> : <ArrowRight size={16}/>}</span></button>)}</div>{choice !== null && <div className="feedback-card"><span>✨</span><div><b>Your move, your meaning</b><p>{currentScenario.choices[choice][2]}</p><button className="text-action" onClick={finishScenario}>Try the next moment <ArrowRight size={15}/></button></div></div>}<div className="scenario-foot"><span>🧡 There is no perfect answer. Your safety and comfort come first.</span><button className="skip-btn" onClick={finishScenario}>Skip for now</button></div></div><div className="trusted-note"><MessageCircleHeart size={21}/><p><b>Need a real-life buddy?</b> If something makes you feel unsafe or pressured, talk to a trusted adult. You can pause the game any time.</p></div></section>}
      {section === 'brain' && <section className="content-panel"><PageHeading eyebrow="BONUS ROUND · BRAIN BREAK" title="Spot the pattern" subtitle="A little brain break: put the cycle phases in order. Take your time—learning is the win." emoji="🧩"/><div className="brain-card"><div className="brain-top"><span className="brain-icon">🧠</span><span className="brain-difficulty">FOCUS QUEST · LEVEL 1</span></div><h2>Which phase comes next?</h2><p>Tap the phase cards in the usual sequence. It begins with the first day of a period. Remember, cycle timing varies.</p><div className="sequence-slots">{[0,1,2,3].map((slot) => <div key={slot} className={`sequence-slot ${sequence[slot] !== undefined ? 'filled' : ''}`}><small>{slot + 1}</small>{sequence[slot] !== undefined ? <><span>{phases[sequence[slot]].emoji}</span><b>{phases[sequence[slot]].name}</b></> : <span className="slot-dash">＋</span>}</div>)}</div><div className="phase-picks">{[2,0,3,1].map((index) => <button key={index} disabled={sequence.includes(index)} onClick={() => selectSequence(index)}>{phases[index].emoji} {phases[index].name}</button>)}</div>{sequence.length === 4 && <div className={`puzzle-result ${sequence.every((item,index)=>item===puzzleOrder[index]) ? 'correct' : 'try-again'}`}><span>{sequence.every((item,index)=>item===puzzleOrder[index]) ? '🎉' : '🌱'}</span><div><b>{sequence.every((item,index)=>item===puzzleOrder[index]) ? 'Pattern spotted! +2 stars' : 'Good try—every round helps it stick.'}</b><p>The usual order is Menstrual → Follicular → Ovulation → Luteal.</p></div></div>}<button className="outline-btn reset-btn" onClick={() => setSequence([])}>↺ Start again</button></div><div className="cognitive-tip"><span>🔎</span><p><b>Think it through:</b> the menstrual phase is day one of a cycle. What happens after the body begins preparing an egg?</p></div></section>}
      {section === 'trail' && <TrailGame step={trailSteps[trailStep]} stepNumber={trailStep + 1} clues={trailClues} choice={trailChoice} onChoose={chooseTrail} onAdvance={advanceTrail}/>}
      {section === 'gbv' && <GbvChapter step={gbvCases[gbvStep]} stepNumber={gbvStep + 1} stage={unlocked ? gbvStage : 'intro'} choice={gbvChoice} clues={gbvClues} onChooseSignal={chooseGbvSignal} onChooseSupport={chooseGbvSupport} onContinue={continueGbv} onReplay={replayGbv} onBack={leaveGbv}/>}
    </main>
    {showRules && <div className="modal-backdrop" onClick={() => setShowRules(false)}><div className="rules-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rules-title"><button className="modal-close" onClick={() => setShowRules(false)} aria-label="Close"><X size={20}/></button><span className="rules-emoji">📖</span><div className="eyebrow">A FEW BUDDIE PROMISES</div><h2 id="rules-title">Play kind. Play at your pace.</h2><ul><li><Check size={17}/> Your body, your boundaries, your choice.</li><li><Check size={17}/> No answer costs you stars. Mistakes are practice.</li><li><Check size={17}/> Keep personal details private; there is no open chat.</li><li><Check size={17}/> Be a buddy: listen, believe, and ask before helping.</li><li><Check size={17}/> For health or safety concerns, find a trusted adult.</li></ul><button className="primary-btn modal-ok" onClick={() => setShowRules(false)}>Got it <Sparkles size={16}/></button></div></div>}
    {authOpen && <div className="modal-backdrop" onClick={() => setAuthOpen(false)}><div className="rules-modal auth-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="modal-close" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={20}/></button><span className="rules-emoji">✨</span><div className="eyebrow">YOUR BUDDIE SPACE</div><h2 id="auth-title">{authMode === 'register' ? 'Make a little account' : 'Welcome back, Buddie'}</h2><p className="auth-privacy">Use a nickname—no real name, email, birth date, or personal details. Your progress saves to this account.</p><form onSubmit={submitAccount}><label>Nickname<input name="username" autoComplete="username" minLength={3} maxLength={18} pattern="[A-Za-z0-9_]+" required placeholder="e.g. star_friend"/></label><label>Password<input name="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} type="password" minLength={10} maxLength={72} required placeholder="10+ characters"/></label>{authMode === 'register' && <label className="adult-confirm"><input type="checkbox" required/> I have checked with a parent or trusted adult before creating this account.</label>}{authMessage && <p className="auth-error" role="alert">{authMessage}</p>}<button className="primary-btn modal-ok" type="submit">{authMode === 'register' ? 'Create account' : 'Sign in'} <ArrowRight size={16}/></button></form><button className="auth-switch" onClick={() => {setAuthMode(authMode === 'register' ? 'login' : 'register');setAuthMessage('');}}>{authMode === 'register' ? 'Already have an account? Sign in' : 'New to Buddie? Create an account'}</button><p className="auth-age-note">For ages 12–17: ask a parent or trusted adult before creating an online account. Keep your password private.</p></div></div>}
  </div>;
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span>{active && <i/>}</button>; }
function PageHeading({ eyebrow, title, subtitle, emoji }: { eyebrow: string; title: string; subtitle: string; emoji: string }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title} <span>{emoji}</span></h1><p>{subtitle}</p></div></div>; }
function TrailGame({ step, stepNumber, clues, choice, onChoose, onAdvance }: { step: typeof trailSteps[number]; stepNumber: number; clues: string[]; choice: number|null; onChoose:(index:number)=>void; onAdvance:()=>void }) {
  return <section className="content-panel trail-panel"><PageHeading eyebrow={`BUDDIE STORY QUEST · SCENE ${stepNumber} OF ${trailSteps.length}`} title="Choose your next move" subtitle="Look around, notice how people feel, and choose a kind next step. There is no game over—every choice gives you something to learn." emoji="🗺️"/><div className="trail-stage"><div className="trail-scene-top"><span>{step.emoji}</span><div><small>{step.place}</small><h2>{step.title}</h2></div><div className="trail-hearts">🧡 🧡 🧡</div></div><div className="trail-world"><div className="trail-orb orb-one"/><div className="trail-orb orb-two"/><div className="trail-sun">☀️</div><div className="trail-characters"><span>🧑🏽‍🤝‍🧑🏻</span><span>{step.emoji}</span><span>👩🏿‍🎤</span></div><div className="trail-ground"/><div className="trail-caption">LOOK AROUND · THINK IT THROUGH · CHOOSE WITH CARE</div></div><p className="trail-story">{step.scene}</p><div className="trail-choice-list">{step.choices.map((option,index)=><button key={option.label} className={`trail-choice ${choice===index?'chosen':''}`} disabled={choice!==null} onClick={()=>onChoose(index)}><span>{option.emoji}</span><b>{option.label}</b><ArrowRight size={16}/></button>)}</div>{choice!==null&&<div className={`trail-outcome ${choice===step.best?'supportive':'reflective'}`}><span>{choice===step.best?'🌟':'🪴'}</span><div><b>{choice===step.best?'Your choice opened a kind path':'A clue for the next moment'}</b><p>{step.choices[choice].result}</p><small>💡 {step.choices[choice].clue}</small><button onClick={onAdvance}>{stepNumber===trailSteps.length?'Back to my space':'Continue the story'} <ArrowRight size={15}/></button></div></div>}{stepNumber===trailSteps.length&&choice!==null&&<div className="trail-recap"><b>Your buddy notes</b>{[...new Set([...clues,step.choices[choice].clue])].map((clue)=> <span key={clue}>✓ {clue}</span>)}</div>}</div><div className="trusted-note"><MessageCircleHeart size={21}/><p><b>Real life is not a game.</b> If something feels unsafe, move to safety and ask a trusted adult for help. You never have to solve it alone.</p></div></section>;
}
function GbvChapter({ step, stepNumber, stage, choice, clues, onChooseSignal, onChooseSupport, onContinue, onReplay, onBack }: { step: typeof gbvCases[number]; stepNumber: number; stage:'intro'|'spot'|'support'|'recap'; choice:number|null; clues:string[]; onChooseSignal:(index:number)=>void; onChooseSupport:(index:number)=>void; onContinue:()=>void; onReplay:()=>void; onBack:()=>void }) {
  const [ready, setReady] = useState(false);
  if (!ready || stage==='intro') return <section className="content-panel gbv-panel"><PageHeading eyebrow="SAFETY QUEST · OPTIONAL" title="Safety, respect & GBV" subtitle="A gentle learning space about recognizing gender-based violence (GBV), respecting boundaries, and supporting someone safely." emoji="🛡️"/><div className="gbv-care-card"><span>🧡</span><div><b>Before you begin</b><p>This chapter includes non-graphic scenarios about controlling behavior, harassment, and image-based abuse. You can skip any part or leave at any time. It is not your job to investigate or fix someone else’s situation.</p></div></div><div className="gbv-toolkit"><h2>Your safety toolkit</h2><div><span>👂</span><b>Listen without blame.</b><small>Believe them, stay calm, and ask what support they want.</small></div><div><span>🛟</span><b>Prioritize safety.</b><small>Move toward a trusted adult or local support if anyone may be at risk.</small></div><div><span>🔒</span><b>Protect privacy.</b><small>Do not forward private messages or images. Avoid confronting someone if that could raise danger.</small></div></div>{stage==='intro'&&<div className="gbv-care-card access-reminder"><span>🔐</span><div><b>Join the live room first</b><p>Sign in and wait for an available player spot before beginning this activity.</p></div></div>}<div className="gbv-start-actions"><button className="outline-btn" onClick={onBack}>Not now · back to my space</button><button className="primary-btn" disabled={stage==='intro'} onClick={()=>setReady(true)}>I’m ready to learn <ArrowRight size={16}/></button></div><div className="gbv-help-line"><b>If this connects to something happening to you:</b> It is not your fault. You deserve support. Talk with a trusted adult, school counselor, health professional, or a local child-protection/domestic-violence support service. If there is immediate danger, contact local emergency services.</div></section>;
  if (stage === 'recap') return <section className="content-panel gbv-panel"><PageHeading eyebrow="SAFETY QUEST · COMPLETE" title="You learned ways to support" subtitle="There is no perfect script. Small, safe, respectful actions can help someone feel less alone." emoji="🌱"/><div className="gbv-recap">{[...new Set(clues)].map((clue,index)=><div key={`${clue}-${index}`}><span>✓</span><p>{clue}</p></div>)}</div><div className="gbv-care-card"><span>🧡</span><div><b>You do not have to carry this alone</b><p>If a real situation worries you, choose a trusted adult or local specialist. Do not promise to keep a safety concern secret.</p></div></div><div className="gbv-start-actions"><button className="outline-btn" onClick={onBack}>Back to my space</button><button className="primary-btn" onClick={onReplay}>Replay the learning quest <ArrowRight size={16}/></button></div></section>;
  const isSpot = stage === 'spot';
  const onChoose = isSpot ? onChooseSignal : onChooseSupport;
  return <section className="content-panel gbv-panel"><PageHeading eyebrow={`SAFETY QUEST · CASE ${stepNumber} OF ${gbvCases.length}`} title="Notice the pattern. Choose safe support." subtitle="No graphic details. Focus on the behavior, the person’s choices, and safe next steps." emoji="🛡️"/><div className="gbv-progress"><span>CASE {stepNumber}/{gbvCases.length}</span><div><i style={{width:`${((stepNumber-1+(isSpot?0:.5))/gbvCases.length)*100}%`}}/></div><button onClick={onBack}>Exit chapter</button></div><div className="gbv-case-card"><div className="gbv-case-head"><span>{step.icon}</span><div><small>{step.place}</small><h2>{step.title}</h2></div></div><div className="gbv-scene"><span>🎬</span><p>{step.scene}</p></div>{isSpot?<><h3 className="gbv-question">{step.signalQuestion}</h3><div className="gbv-options">{step.signals.map(([emoji,label],index)=><button key={label} className={choice===index?'picked':''} disabled={choice!==null} onClick={()=>onChoose(index)}><span>{emoji}</span><b>{label}</b>{choice===index&&<Check size={16}/>}</button>)}</div>{choice!==null&&<div className="gbv-feedback"><b>Pattern note</b><p>{step.signalFeedback}</p><button className="text-action" onClick={onContinue}>Practice a safe response <ArrowRight size={15}/></button></div>}</>:<><h3 className="gbv-question">Your first priority is the person’s safety and choices. What could you do?</h3><div className="gbv-options">{step.responses.map(([emoji,label],index)=><button key={label} className={choice===index?'picked':''} disabled={choice!==null} onClick={()=>onChoose(index)}><span>{emoji}</span><b>{label}</b>{choice===index&&<Check size={16}/>}</button>)}</div>{choice!==null&&<div className="gbv-feedback"><b>A caring next step</b><p>{step.responses[choice][2]}</p><button className="text-action" onClick={onContinue}>{stepNumber===gbvCases.length?'See your safety notes':'Continue to next case'} <ArrowRight size={15}/></button></div>}</>}<div className="gbv-case-footer"><ShieldAlert size={16}/><span>It is never the person’s fault for being targeted. No one has to confront someone or manage danger alone.</span></div></div><div className="gbv-help-line"><b>Real-life help:</b> Talk to a trusted adult, counselor, health professional, or local support service. If there is immediate danger, contact local emergency services. <button onClick={onBack}>Leave this chapter</button></div></section>;
}
function HomePage({ avatar, stars, completed, setSection, mode, setMode, admission, groupInfo, onJoinGroup, onGroupVote, onTrail, onGbv, onAccount, account }: { avatar: {face:string;name:string}; stars:number; completed:string[]; setSection:(section:string)=>void; mode:'solo'|'group'; setMode:(mode:'solo'|'group')=>void; admission:Admission; groupInfo:{status:'idle'|'waiting'|'matched';votes:number[]}; onJoinGroup:()=>void; onGroupVote:(choice:number)=>void; onTrail:()=>void; onGbv:()=>void; onAccount:()=>void; account:PlayerAccount|null }) {
  return <div className="home-content"><section className="welcome-card"><div className="welcome-copy"><div className="hello-pill"><span className="hello-spark">✦</span> YOUR SPACE, YOUR PACE</div><h1>Hey, {avatar.name}!<br/><span>Ready for a little</span><br/>main-character energy?</h1><p>A cozy place to learn about your body, your choices, and showing up for your friends.</p><div className="welcome-buttons"><button className="primary-btn" onClick={() => setSection('cycle')}>Continue your journey <ArrowRight size={17}/></button><button className="rules-link" onClick={() => setSection('boundaries')}>Explore boundaries <span>↗</span></button></div><div className="welcome-stats"><span><Star size={15} fill="currentColor"/> {stars} kind choices</span><span className="stat-dot"/><span>{completed.length} moments explored</span></div></div><div className="hero-art"><div className="sun-blob"/><div className="sparkle s-one">✦</div><div className="sparkle s-two">✧</div><div className="sparkle s-three">✦</div><div className="hero-figure"><div className="hero-hair"/><div className="hero-face">{avatar.face}</div><div className="hero-body"/></div><div className="art-sticker sticker-cycle">🌸<span>grow your way</span></div><div className="art-sticker sticker-heart">♡</div><div className="art-caption">“My pace is the right pace.”</div></div></section>
    <div className="section-title-row"><div><div className="eyebrow">PICK YOUR PATH</div><h2>Where to, Buddie?</h2></div><button className="see-all" onClick={() => setSection('cycle')}>See all <ArrowRight size={15}/></button></div>
    <section className="journey-grid"><button className="journey-tile tile-cycle" onClick={() => setSection('cycle')}><div className="tile-top"><span className="tile-emoji">🌷</span><span className="tile-time">4 MIN · LEARN</span></div><h3>The wonderful you</h3><p>Your body’s changing story, one phase at a time.</p><div className="tile-bottom"><span className="tile-progress"><i style={{width:completed.includes('body-basics')?'100%':'18%'}}/></span><span>{completed.includes('body-basics')?'Done':'Start here'} <ArrowRight size={15}/></span></div></button><button className="journey-tile tile-boundary" onClick={() => setSection('boundaries')}><div className="tile-top"><span className="tile-emoji">🦋</span><span className="tile-time">6 MIN · PRACTICE</span></div><h3>Peace over pressure</h3><p>Find your voice when the world gets a little loud.</p><div className="tile-bottom"><span className="tile-progress"><i style={{width:`${completed.length*20}%`}}/></span><span>Explore <ArrowRight size={15}/></span></div></button><button className="journey-tile tile-brain" onClick={() => setSection('brain')}><div className="tile-top"><span className="tile-emoji">🧩</span><span className="tile-time">2 MIN · BRAIN BREAK</span></div><h3>Spot the pattern</h3><p>A quick puzzle to keep your curious brain bright.</p><div className="tile-bottom"><span className="tile-progress"><i style={{width:'0%'}}/></span><span>Play now <ArrowRight size={15}/></span></div></button><button className="journey-tile tile-trail" onClick={onTrail}><div className="tile-top"><span className="tile-emoji">🗺️</span><span className="tile-time">5 MIN · STORY QUEST</span></div><h3>Choose your next move</h3><p>Explore school, chat, and friendship moments. Notice how choices change the story.</p><div className="tile-bottom"><span className="tile-progress"><i style={{width:'0%'}}/></span><span>Play the story <ArrowRight size={15}/></span></div></button><button className="journey-tile tile-gbv" onClick={onGbv}><div className="tile-top"><span className="tile-emoji">🛡️</span><span className="tile-time">6 MIN · SAFETY QUEST</span></div><h3>Safety, respect & GBV</h3><p>Spot controlling behavior, harassment, and ways to support someone safely.</p><div className="tile-bottom"><span className="tile-progress"><i style={{width:completed.includes('gbv')?'100%':'0%'}}/></span><span>{completed.includes('gbv')?'Replay':'Explore safely'} <ArrowRight size={15}/></span></div></button></section>
    <section className="together-card"><div className="together-icon"><Users size={22}/></div><div className="together-copy"><h3>Good things grow together</h3><p>No chat, no personal details—just a quick, kind-choice challenge with another player.</p></div><div className="mode-switch"><button className={mode==='solo'?'selected':''} onClick={()=>setMode('solo')}>Solo</button><button className={mode==='group'?'selected':''} onClick={()=>setMode('group')}>Group</button></div><button className="group-join" onClick={()=>{setMode('group');onJoinGroup();}}>{groupInfo.status==='waiting'?'Finding a buddy…':groupInfo.status==='matched'?'Buddy paired ✓':'Join a buddy round'} <ArrowRight size={15}/></button>{groupInfo.status==='matched'&&<div className="group-vote"><b>Your team’s quick pick</b><span>What is a kind first move when a friend feels pressured?</span><div>{['Listen without judging','Ask what support they want','Help them find a trusted adult'].map((answer,index)=><button key={answer} onClick={()=>onGroupVote(index)}>{answer}<small>{groupInfo.votes[index] ?? 0} votes</small></button>)}</div></div>}</section>
    {!account && <section className="account-invite"><span>💾</span><div><b>Keep your journey safe</b><p>Create a nickname account to save stars and story progress on this device or your hosted Buddie server.</p></div><button onClick={onAccount}>Create account <ArrowRight size={15}/></button></section>}
    <div className="safety-footer"><span>🧡</span><span>Here to learn, never to judge. Keep personal information private.</span><span className="server-status"><i className={admission.state==='active'?'live':''}/>{admission.state==='active'?`${admission.active ?? '…'} / ${admission.limit ?? 5000} playing`:'Buddie play room'}</span></div>
  </div>;
}
function sectionTitle(section:string) { return ({home:'My space',cycle:'Body basics',boundaries:'Your boundaries',brain:'Brain break'} as Record<string,string>)[section] ?? 'My space'; }
