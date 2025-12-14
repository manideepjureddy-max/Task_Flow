import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, LiveServerMessage, Modality, FunctionDeclaration } from "@google/genai";
import { 
  Plus, 
  Trash2, 
  Edit2, 
  CheckCircle2, 
  Circle, 
  Sparkles, 
  Calendar, 
  X,
  Loader2,
  Search,
  ListTodo,
  Mic,
  MicOff,
  Activity,
  Menu,
  Home,
  Settings,
  MessageSquare,
  LogOut,
  ChevronRight,
  Database,
  Archive,
  Clock,
  AlertCircle,
  Bell,
  AlertTriangle,
  User,
  ListChecks,
  Award,
  Trophy,
  Zap,
  Target,
  Medal
} from 'lucide-react';

// --- Configuration ---

const API_KEY = process.env.API_KEY;
const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- Types (Matching Django Model Structure) ---

type Priority = 'Low' | 'Medium' | 'High';

interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

interface Task {
  id: number;
  title: string;
  description: string;
  priority: Priority;
  completed: boolean;
  created_at: string;
  due_date?: string;
  completed_at?: string;
  subtasks?: Subtask[];
}

interface ToastMessage {
  id: string;
  message: string;
  type: 'warning' | 'error' | 'success' | 'info';
}

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  isUnlocked: (tasks: Task[]) => boolean;
}

// --- Mock Django Backend API ---

const DB_NAME = 'django_sql_db_v1';

const DjangoAPI = {
  async getTasks(): Promise<Task[]> {
    await new Promise(resolve => setTimeout(resolve, 500));
    const raw = localStorage.getItem(DB_NAME);
    return raw ? JSON.parse(raw) : [];
  },

  async createTask(data: Omit<Task, 'id' | 'created_at'>): Promise<Task> {
    await new Promise(resolve => setTimeout(resolve, 400));
    const tasks = await this.getTasks();
    const nextId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1;
    const newTask: Task = {
      ...data,
      id: nextId,
      subtasks: data.subtasks || [],
      created_at: new Date().toISOString(),
    };
    localStorage.setItem(DB_NAME, JSON.stringify([newTask, ...tasks]));
    return newTask;
  },

  async updateTask(id: number, updates: Partial<Task>): Promise<Task> {
    await new Promise(resolve => setTimeout(resolve, 300));
    const tasks = await this.getTasks();
    const index = tasks.findIndex(t => t.id === id);
    if (index === -1) throw new Error('404 Not Found');
    const updatedTask = { ...tasks[index], ...updates };
    tasks[index] = updatedTask;
    localStorage.setItem(DB_NAME, JSON.stringify(tasks));
    return updatedTask;
  },

  async deleteTask(id: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 300));
    const tasks = await this.getTasks();
    const filtered = tasks.filter(t => t.id !== id);
    localStorage.setItem(DB_NAME, JSON.stringify(filtered));
  },

  async deleteCompletedTasks(): Promise<number> {
    await new Promise(resolve => setTimeout(resolve, 500));
    const tasks = await this.getTasks();
    const initialCount = tasks.length;
    const activeTasks = tasks.filter(t => !t.completed);
    localStorage.setItem(DB_NAME, JSON.stringify(activeTasks));
    return initialCount - activeTasks.length;
  },

  async clearDatabase(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 500));
    localStorage.removeItem(DB_NAME);
  }
};

// --- Utils ---

function float32To16BitPCM(float32: Float32Array): ArrayBuffer {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
      let s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToFloat32Array(base64: string): Float32Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for(let i=0; i<int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

const toLocalISOString = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
  return localISOTime;
};

// --- Live Tools Definition ---

const liveTools: FunctionDeclaration[] = [
  {
    name: "create_task",
    description: "Create a new task with a title, priority, description, and optional due date.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        description: { type: Type.STRING },
        priority: { type: Type.STRING, enum: ["Low", "Medium", "High"] },
        due_date: { type: Type.STRING, description: "ISO 8601 format date time string (e.g. 2024-12-31T15:00)" }
      },
      required: ["title"]
    }
  },
  {
    name: "get_tasks",
    description: "Get the user's current list of tasks.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    }
  },
  {
    name: "update_task_status",
    description: "Mark a task as completed or active by its ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.NUMBER },
        completed: { type: Type.BOOLEAN }
      },
      required: ["id", "completed"]
    }
  },
  {
    name: "delete_task",
    description: "Delete a specific task permanently by its ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.NUMBER }
      },
      required: ["id"]
    }
  },
  {
    name: "delete_completed_tasks",
    description: "Delete all tasks that are marked as completed. Use this for cleanup.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    }
  }
];

// --- New Components: Views, Menu, Toasts ---

const ToastContainer = ({ toasts, removeToast }: { toasts: ToastMessage[], removeToast: (id: string) => void }) => {
  return (
    <div className="toast-container-custom position-fixed bottom-0 start-50 translate-middle-x p-3" style={{ zIndex: 1100, maxWidth: '90vw', width: '400px' }}>
      <div className="d-flex flex-column gap-2">
        {toasts.map(toast => (
          <div 
            key={toast.id} 
            className={`alert shadow-lg mb-0 d-flex align-items-center border-0 ${
              toast.type === 'error' ? 'bg-danger text-white' : 
              toast.type === 'warning' ? 'bg-warning text-dark' : 
              'bg-success text-white'
            }`}
            role="alert"
          >
            <div className="me-2">
              {toast.type === 'error' && <AlertCircle size={20} />}
              {toast.type === 'warning' && <AlertTriangle size={20} />}
              {toast.type === 'success' && <CheckCircle2 size={20} />}
            </div>
            <div className="flex-grow-1 fw-medium">{toast.message}</div>
            <button 
              type="button" 
              className={`btn-close ${toast.type !== 'warning' ? 'btn-close-white' : ''}`} 
              onClick={() => removeToast(toast.id)}
            ></button>
          </div>
        ))}
      </div>
    </div>
  );
};

const SideMenu = ({ 
  isOpen, 
  onClose, 
  currentView, 
  onViewChange 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  currentView: string; 
  onViewChange: (view: 'home' | 'profile' | 'settings' | 'feedback') => void;
}) => {
  const handleNav = (view: 'home' | 'profile' | 'settings' | 'feedback') => {
    onViewChange(view);
    onClose();
  };

  return (
    <>
      <div 
        className={`sidebar-backdrop ${isOpen ? 'show' : ''}`} 
        onClick={onClose}
      />
      <div className={`sidebar-menu ${isOpen ? 'show' : ''} d-flex flex-column`}>
        <div className="p-4 border-bottom d-flex align-items-center justify-content-between">
           <div className="d-flex align-items-center gap-2 text-primary fw-bold">
              <ListTodo size={24} />
              <span>TaskFlow AI</span>
           </div>
           <button onClick={onClose} className="btn btn-sm btn-light rounded-circle p-2">
             <X size={20} />
           </button>
        </div>
        
        <div className="p-3 flex-grow-1">
          <button 
            onClick={() => handleNav('home')}
            className={`btn w-100 text-start nav-link-custom ${currentView === 'home' ? 'active' : ''}`}
          >
            <Home size={20} /> Home
          </button>
          <button 
            onClick={() => handleNav('profile')}
            className={`btn w-100 text-start nav-link-custom ${currentView === 'profile' ? 'active' : ''}`}
          >
            <User size={20} /> Profile
          </button>
          <button 
            onClick={() => handleNav('settings')}
            className={`btn w-100 text-start nav-link-custom ${currentView === 'settings' ? 'active' : ''}`}
          >
            <Settings size={20} /> Settings
          </button>
          <button 
            onClick={() => handleNav('feedback')}
            className={`btn w-100 text-start nav-link-custom ${currentView === 'feedback' ? 'active' : ''}`}
          >
            <MessageSquare size={20} /> Feedback
          </button>
        </div>

        <div className="p-4 border-top bg-light">
          <small className="text-muted d-block mb-1">Version 1.3.1</small>
          <small className="text-muted">© 2025 TaskFlow Inc.</small>
        </div>
      </div>
    </>
  );
};

const MobileBottomNav = ({ 
  currentView, 
  onViewChange,
  isLiveActive,
  onToggleLive
}: { 
  currentView: string; 
  onViewChange: (view: 'home' | 'profile' | 'settings' | 'feedback') => void;
  isLiveActive: boolean;
  onToggleLive: () => void;
}) => {
  return (
    <div className="mobile-bottom-nav">
      <button 
        className={`mobile-nav-item ${currentView === 'home' ? 'active' : ''}`} 
        onClick={() => onViewChange('home')}
      >
        <Home size={24} />
        <span>Home</span>
      </button>

      <button 
        className={`mobile-nav-item ${isLiveActive ? 'text-danger' : ''}`}
        onClick={onToggleLive}
      >
        {isLiveActive ? <MicOff size={24} className="animate-pulse" /> : <Mic size={24} />}
        <span>{isLiveActive ? 'Stop' : 'Voice'}</span>
      </button>

      <button 
        className={`mobile-nav-item ${currentView === 'profile' ? 'active' : ''}`} 
        onClick={() => onViewChange('profile')}
      >
        <User size={24} />
        <span>Profile</span>
      </button>
      
      <button 
        className={`mobile-nav-item ${currentView === 'settings' ? 'active' : ''}`} 
        onClick={() => onViewChange('settings')}
      >
        <Settings size={24} />
        <span>Settings</span>
      </button>
    </div>
  );
};

const BADGES: Badge[] = [
  {
    id: 'first_step',
    name: 'First Step',
    description: 'Complete your first task',
    icon: Zap,
    color: '#fbbf24', // Amber
    isUnlocked: (tasks) => tasks.filter(t => t.completed).length >= 1
  },
  {
    id: 'on_a_roll',
    name: 'On a Roll',
    description: 'Complete 5 tasks',
    icon: Activity,
    color: '#60a5fa', // Blue
    isUnlocked: (tasks) => tasks.filter(t => t.completed).length >= 5
  },
  {
    id: 'punctual',
    name: 'Punctual',
    description: 'Complete a task on time',
    icon: Clock,
    color: '#34d399', // Emerald
    isUnlocked: (tasks) => tasks.some(t => t.completed && t.due_date && t.completed_at && new Date(t.completed_at) <= new Date(t.due_date))
  },
  {
    id: 'time_master',
    name: 'Time Master',
    description: 'Complete 5 tasks on time',
    icon: Target,
    color: '#f472b6', // Pink
    isUnlocked: (tasks) => tasks.filter(t => t.completed && t.due_date && t.completed_at && new Date(t.completed_at) <= new Date(t.due_date)).length >= 5
  },
  {
    id: 'productivity_king',
    name: 'Task King',
    description: 'Complete 10 tasks',
    icon: Trophy,
    color: '#818cf8', // Indigo
    isUnlocked: (tasks) => tasks.filter(t => t.completed).length >= 10
  }
];

const ProfileView = ({
  tasks,
  addToast
}: {
  tasks: Task[],
  addToast: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;
}) => {
  const [profile, setProfile] = useState({
    username: 'Guest User',
    bio: '',
    avatar: ''
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('user_profile');
    if (saved) {
      try {
        setProfile(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse user profile", e);
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('user_profile', JSON.stringify(profile));
    addToast('Profile updated successfully!', 'success');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5000000) { // Simple client-side size check (5MB)
        addToast('Image too large for local storage.', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfile(prev => ({ ...prev, avatar: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const completedCount = tasks.filter(t => t.completed).length;
  const onTimeCount = tasks.filter(t => t.completed && t.due_date && t.completed_at && new Date(t.completed_at) <= new Date(t.due_date)).length;

  return (
    <div className="container py-4">
       <h2 className="fw-bold mb-4">My Profile</h2>

       {/* User Profile Section */}
       <div className="card border-0 shadow-sm mb-4">
        <div className="card-body p-4">
          <div className="d-flex flex-column flex-sm-row gap-4 align-items-center align-items-sm-start">
            <div className="position-relative flex-shrink-0">
              <div 
                className="rounded-circle overflow-hidden bg-light d-flex align-items-center justify-content-center border"
                style={{ width: '100px', height: '100px', cursor: 'pointer' }}
                onClick={() => fileInputRef.current?.click()}
              >
                {profile.avatar ? (
                  <img src={profile.avatar} alt="Avatar" className="w-100 h-100 object-fit-cover" />
                ) : (
                  <User size={48} className="text-secondary opacity-50" />
                )}
              </div>
              <button 
                className="btn btn-sm btn-primary rounded-circle position-absolute bottom-0 end-0 shadow-sm d-flex align-items-center justify-content-center"
                style={{ width: '32px', height: '32px', padding: 0 }}
                onClick={() => fileInputRef.current?.click()}
              >
                <Edit2 size={14} />
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="d-none" 
                accept="image/*"
                onChange={handleFileChange} 
              />
            </div>

            <div className="flex-grow-1 w-100">
              <div className="mb-3">
                <label className="form-label fw-medium small text-muted text-uppercase">Username</label>
                <input 
                  type="text" 
                  className="form-control bg-light border-0"
                  value={profile.username}
                  onChange={e => setProfile({...profile, username: e.target.value})}
                  placeholder="Enter username"
                />
              </div>
              <div className="mb-3">
                <label className="form-label fw-medium small text-muted text-uppercase">Bio</label>
                <textarea 
                  className="form-control bg-light border-0"
                  rows={2}
                  value={profile.bio}
                  onChange={e => setProfile({...profile, bio: e.target.value})}
                  placeholder="Tell us a bit about yourself..."
                />
              </div>
              <div className="text-end">
                <button className="btn btn-primary rounded-pill px-4" onClick={handleSave}>
                  Save Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Badges & Achievements Section */}
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body p-4">
          <h5 className="card-title fw-bold mb-3 d-flex align-items-center gap-2">
            <Award size={20} className="text-warning" />
            Achievements
          </h5>
          <div className="d-flex gap-4 mb-4 text-center">
             <div className="flex-grow-1 p-3 rounded-3 bg-light">
                <h3 className="fw-bold mb-0 text-primary">{completedCount}</h3>
                <small className="text-muted text-uppercase fw-bold" style={{fontSize: '0.7rem'}}>Total Tasks</small>
             </div>
             <div className="flex-grow-1 p-3 rounded-3 bg-light">
                <h3 className="fw-bold mb-0 text-success">{onTimeCount}</h3>
                <small className="text-muted text-uppercase fw-bold" style={{fontSize: '0.7rem'}}>On Time</small>
             </div>
          </div>
          
          <div className="row g-3">
            {BADGES.map((badge) => {
              const unlocked = badge.isUnlocked(tasks);
              const Icon = badge.icon;
              return (
                <div key={badge.id} className="col-4 col-sm-3 col-md-2">
                  <div className="text-center group" style={{opacity: unlocked ? 1 : 0.4}}>
                    <div 
                      className="rounded-circle d-flex align-items-center justify-content-center mx-auto mb-2 shadow-sm position-relative"
                      style={{
                        width: '56px', 
                        height: '56px', 
                        backgroundColor: unlocked ? badge.color : '#e9ecef',
                        color: unlocked ? 'white' : '#adb5bd',
                        transition: 'transform 0.2s'
                      }}
                    >
                      <Icon size={24} />
                      {unlocked && (
                         <div className="position-absolute top-0 start-100 translate-middle p-1 bg-success border border-light rounded-circle">
                           <span className="visually-hidden">Unlocked</span>
                         </div>
                      )}
                    </div>
                    <p className="fw-bold small mb-0 text-truncate">{badge.name}</p>
                    <p className="text-muted small mb-0 d-none d-sm-block" style={{fontSize: '0.65rem'}}>{badge.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const SettingsView = ({ 
  onClearData
}: { 
  onClearData: () => void;
}) => {
  return (
    <div className="container py-4">
      <h2 className="fw-bold mb-4">Settings</h2>
      
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-body p-4">
          <h5 className="card-title fw-bold mb-3 d-flex align-items-center gap-2">
            <Sparkles size={20} className="text-primary" />
            AI Preferences
          </h5>
          <div className="d-flex justify-content-between align-items-center py-3 border-bottom">
             <div>
               <p className="mb-0 fw-medium">Voice Personality</p>
               <small className="text-muted">Choose how TaskFlow sounds</small>
             </div>
             <select className="form-select w-auto" defaultValue="Professional">
               <option>Professional</option>
               <option>Friendly</option>
               <option>Enthusiastic</option>
             </select>
          </div>
          <div className="d-flex justify-content-between align-items-center py-3">
             <div>
               <p className="mb-0 fw-medium">Auto-Enhance Tasks</p>
               <small className="text-muted">Automatically polish task descriptions</small>
             </div>
             <div className="form-check form-switch">
               <input className="form-check-input" type="checkbox" defaultChecked />
             </div>
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm border-start border-danger border-4">
        <div className="card-body p-4">
          <h5 className="card-title fw-bold mb-3 text-danger d-flex align-items-center gap-2">
            <Database size={20} />
            Danger Zone
          </h5>
          <p className="text-muted mb-3">
            Permanently delete all your tasks and data. This action cannot be undone.
          </p>
          <button 
            onClick={() => {
              if(confirm("Are you sure? This will wipe all your tasks.")) {
                onClearData();
              }
            }} 
            className="btn btn-outline-danger"
          >
            Clear All Data
          </button>
        </div>
      </div>
    </div>
  );
};

const FeedbackView = () => {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="container py-5 text-center">
        <div className="card border-0 shadow-sm p-5 d-inline-block">
          <div className="mb-3 text-success">
            <CheckCircle2 size={48} />
          </div>
          <h3>Thank You!</h3>
          <p className="text-muted">Your feedback helps us make TaskFlow better.</p>
          <button onClick={() => setSubmitted(false)} className="btn btn-primary mt-3">Send Another</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-4">
      <h2 className="fw-bold mb-4">Send Feedback</h2>
      <div className="card border-0 shadow-sm" style={{maxWidth: '600px'}}>
        <div className="card-body p-4">
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label fw-medium">How can we improve?</label>
              <textarea 
                className="form-control" 
                rows={5} 
                placeholder="Tell us what you like or what isn't working..."
                required
              ></textarea>
            </div>
            <div className="mb-3">
              <label className="form-label fw-medium">Email (Optional)</label>
              <input type="email" className="form-control" placeholder="For follow-up..." />
            </div>
            <div className="text-end">
              <button type="submit" className="btn btn-primary d-flex align-items-center gap-2 ms-auto">
                Submit Feedback <ChevronRight size={16} />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

// --- Reusable Components ---

const PriorityBadge = ({ priority }: { priority: Priority }) => {
  const badgeClass = {
    Low: 'text-bg-success',
    Medium: 'text-bg-warning',
    High: 'text-bg-danger',
  };

  return (
    <span className={`badge rounded-pill ${badgeClass[priority]} bg-opacity-75`}>
      {priority}
    </span>
  );
};

interface TaskCardProps {
  task: Task;
  onToggle: (id: number, current: boolean) => void;
  onEdit: (task: Task) => void;
  onDelete: (id: number) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onToggle, onEdit, onDelete }) => {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !task.completed;
  const subtasks = task.subtasks || [];
  const completedSubtasks = subtasks.filter(st => st.completed).length;

  const getRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));
  
    if (diff < 0) {
      if (Math.abs(hours) < 1) return `Overdue by ${Math.abs(minutes)}m`;
      if (Math.abs(hours) < 24) return `Overdue by ${Math.abs(hours)}h`;
      return `Overdue by ${Math.abs(days)}d`;
    }
  
    if (hours < 1) return `Due in ${minutes}m`;
    if (hours < 24) return `Due in ${hours}h`;
    if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div 
      className={`card border-0 shadow-sm task-card mb-2 ${task.completed ? 'bg-light opacity-75' : 'bg-white'}`}
      style={{ borderRadius: '12px' }}
    >
      <div className="card-body p-3 d-flex align-items-start gap-3">
        <button 
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(task.id, task.completed); }}
          className="btn btn-link p-0 text-decoration-none mt-1"
          style={{ color: task.completed ? '#198754' : '#dee2e6' }}
        >
          {task.completed ? <CheckCircle2 size={24} className="fill-current" /> : <Circle size={24} strokeWidth={2} />}
        </button>

        {/* min-width: 0 is crucial for flexbox text truncation to work properly on mobile */}
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <div className="d-flex align-items-center gap-2">
            <h5 className={`card-title mb-1 fw-semibold ${task.completed ? 'text-decoration-line-through text-muted' : 'text-dark'}`}>
              {task.title}
            </h5>
            {isOverdue && !task.completed && (
              <span className="badge bg-danger rounded-pill py-1 px-2" style={{fontSize: '0.6rem'}}>Overdue</span>
            )}
          </div>
          {task.description && (
            <p className="card-text text-muted small mb-2 text-truncate" style={{ whiteSpace: 'pre-line' }}>
              {task.description}
            </p>
          )}
          
          <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
            <PriorityBadge priority={task.priority} />
            {task.due_date ? (
              <small className={`d-flex align-items-center gap-1 px-2 py-1 rounded-pill ${isOverdue ? 'bg-danger bg-opacity-10 text-danger fw-bold' : 'bg-primary bg-opacity-10 text-primary'}`}>
                {isOverdue ? <AlertCircle size={12} /> : <Calendar size={12} />}
                {getRelativeTime(task.due_date)}
              </small>
            ) : (
              <small className="text-secondary d-flex align-items-center gap-1 px-2 py-1 rounded-pill">
                <Clock size={12} />
                {new Date(task.created_at).toLocaleDateString()}
              </small>
            )}
            {subtasks.length > 0 && (
              <small className="d-flex align-items-center gap-1 px-2 py-1 rounded-pill bg-info bg-opacity-10 text-info fw-bold">
                <ListChecks size={12} />
                {completedSubtasks}/{subtasks.length}
              </small>
            )}
          </div>
        </div>

        <div className="d-flex gap-1 flex-shrink-0">
          <button 
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(task); }} 
            className="btn btn-sm bg-transparent border-0 text-muted p-2 hover-primary"
          >
            <Edit2 size={16} />
          </button>
          <button 
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(task.id); }} 
            className="btn btn-sm bg-transparent border-0 text-danger p-2 hover-danger"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

const TaskModal = ({ 
  isOpen, 
  onClose, 
  onSave, 
  initialData 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onSave: (data: Omit<Task, 'id' | 'created_at' | 'completed'>) => Promise<void>;
  initialData?: Task;
}) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'Medium' as Priority,
    due_date: '',
    subtasks: [] as Subtask[]
  });
  const [newSubtask, setNewSubtask] = useState('');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [minDate, setMinDate] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMinDate(toLocalISOString(new Date()));
      if (initialData) {
        // Correctly format the date for the datetime-local input
        // It requires YYYY-MM-DDThh:mm (16 chars)
        const formattedDate = initialData.due_date ? initialData.due_date.slice(0, 16) : '';
        setFormData({
          title: initialData.title,
          description: initialData.description,
          priority: initialData.priority,
          due_date: formattedDate,
          subtasks: initialData.subtasks || []
        });
      } else {
        setFormData({ title: '', description: '', priority: 'Medium', due_date: '', subtasks: [] });
      }
    }
  }, [isOpen, initialData]);

  const handleEnhance = async () => {
    if (!formData.title) return;
    setIsEnhancing(true);

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are an AI assistant for a Todo List app.
        Refine this task:
        Title: "${formData.title}"
        Description: "${formData.description}"
        
        Outputs:
        1. Clearer title.
        2. Expanded description (add bullet points if helpful).
        3. Priority level (Low, Medium, High).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              priority: { type: Type.STRING, enum: ["Low", "Medium", "High"] }
            },
            required: ["title", "description", "priority"]
          }
        }
      });

      const enhanced = JSON.parse(response.text);
      setFormData({ ...formData, ...enhanced }); // Keep existing due_date and subtasks
    } catch (e) {
      console.error(e);
      alert("AI Service Unavailable");
    } finally {
      setIsEnhancing(false);
    }
  };

  const addSubtask = () => {
    if (!newSubtask.trim()) return;
    const st: Subtask = {
      id: Date.now().toString(),
      title: newSubtask,
      completed: false
    };
    setFormData(prev => ({ ...prev, subtasks: [...(prev.subtasks || []), st] }));
    setNewSubtask('');
  };

  const toggleSubtask = (id: string) => {
     setFormData(prev => ({
       ...prev,
       subtasks: prev.subtasks?.map(st => st.id === id ? { ...st, completed: !st.completed } : st)
     }));
  };

  const deleteSubtask = (id: string) => {
     setFormData(prev => ({
       ...prev,
       subtasks: prev.subtasks?.filter(st => st.id !== id)
     }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    await onSave(formData);
    setIsSaving(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay position-fixed top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center" style={{ zIndex: 1050 }}>
      <div className="card shadow-lg border-0 rounded-4 overflow-hidden" style={{ width: '100%', maxWidth: '500px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div className="card-header bg-white d-flex justify-content-between align-items-center py-3 border-bottom-0 flex-shrink-0">
          <h5 className="card-title mb-0 fw-bold">{initialData ? 'Edit Task' : 'New Task'}</h5>
          <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
        </div>
        
        <div className="card-body pt-0 overflow-y-auto">
          <form id="task-form" onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label fw-medium text-muted small text-uppercase">Title</label>
              <input 
                type="text" 
                className="form-control form-control-lg bg-light border-0" 
                value={formData.title} 
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                required 
                placeholder="What needs to be done?"
              />
            </div>
            
            <div className="mb-3">
              <div className="d-flex justify-content-between align-items-center mb-1">
                <label className="form-label fw-medium text-muted small text-uppercase mb-0">Description</label>
                <button 
                  type="button" 
                  onClick={handleEnhance} 
                  disabled={isEnhancing || !formData.title}
                  className="btn btn-sm btn-link text-decoration-none d-flex align-items-center gap-1"
                >
                  {isEnhancing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  AI Enhance
                </button>
              </div>
              <textarea 
                className="form-control bg-light border-0" 
                rows={3}
                value={formData.description} 
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Add more details..."
              ></textarea>
            </div>

            <div className="mb-3">
               <label className="form-label fw-medium text-muted small text-uppercase d-flex align-items-center gap-2">
                 <ListChecks size={14} /> Checklist
               </label>
               <div className="d-flex flex-column gap-2 mb-2">
                  {formData.subtasks?.map(st => (
                     <div key={st.id} className="d-flex align-items-center gap-2 ps-3">
                        <button 
                          type="button" 
                          onClick={() => toggleSubtask(st.id)}
                          className={`btn btn-sm p-0 ${st.completed ? 'text-success' : 'text-muted'}`}
                        >
                          {st.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                        </button>
                        <span className={`flex-grow-1 ${st.completed ? 'text-decoration-line-through text-muted' : ''}`}>
                          {st.title}
                        </span>
                        <button type="button" onClick={() => deleteSubtask(st.id)} className="btn btn-sm text-danger opacity-50 hover-opacity-100 p-0"><Trash2 size={14}/></button>
                     </div>
                  ))}
               </div>
               
               <div className="d-flex gap-2 align-items-center ps-3">
                  <Plus size={16} className="text-muted" />
                  <input 
                    type="text" 
                    className="form-control form-control-sm bg-light border-0"
                    placeholder="Add a step..."
                    value={newSubtask}
                    onChange={e => setNewSubtask(e.target.value)}
                    onKeyDown={e => { if(e.key === 'Enter') { e.preventDefault(); addSubtask(); }}}
                  />
                  <button type="button" onClick={addSubtask} className="btn btn-sm btn-light text-primary fw-medium">Add</button>
               </div>
            </div>

            <div className="row">
              <div className="col-md-6 mb-3">
                <label className="form-label fw-medium text-muted small text-uppercase">Due Date</label>
                <input 
                  type="datetime-local" 
                  className="form-control bg-light border-0"
                  value={formData.due_date}
                  min={minDate}
                  onChange={e => setFormData({ ...formData, due_date: e.target.value })}
                />
              </div>
              <div className="col-md-6 mb-3">
                <label className="form-label fw-medium text-muted small text-uppercase">Priority</label>
                <div className="d-flex gap-2">
                   {(['Low', 'Medium', 'High'] as const).map(p => (
                     <button
                       key={p}
                       type="button"
                       className={`btn flex-grow-1 ${formData.priority === p ? (p === 'High' ? 'btn-danger' : p === 'Medium' ? 'btn-warning' : 'btn-success') : 'btn-light'}`}
                       onClick={() => setFormData({...formData, priority: p})}
                     >
                       {p}
                     </button>
                   ))}
                </div>
              </div>
            </div>
          </form>
        </div>
        
        <div className="card-footer bg-white border-top-0 text-end py-3 flex-shrink-0">
          <button type="button" className="btn btn-light me-2 rounded-pill px-4" onClick={onClose}>Cancel</button>
          <button type="submit" form="task-form" className="btn btn-primary rounded-pill px-4" disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Task'}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Main Application ---

const App = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>(undefined);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [currentTime, setCurrentTime] = useState(new Date());

  // Notification State
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const notifiedRef = useRef<Record<number, { approaching: boolean, overdue: boolean }>>({});
  const tasksRef = useRef<Task[]>([]); // Ref to access latest tasks inside interval

  // Navigation State
  const [currentView, setCurrentView] = useState<'home' | 'profile' | 'settings' | 'feedback'>('home');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Live API State
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Sync tasks ref
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Toast Handler
  const addToast = (message: string, type: ToastMessage['type']) => {
    const id = Date.now().toString() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000); // 6 seconds display
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Clock & Notification Check Effect
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      // Check Deadlines
      tasksRef.current.forEach(task => {
        if (task.completed || !task.due_date) return;
        
        const dueDate = new Date(task.due_date);
        const diffMs = dueDate.getTime() - now.getTime();
        const diffMins = diffMs / 60000;

        // Initialize tracking if needed
        if (!notifiedRef.current[task.id]) {
           notifiedRef.current[task.id] = { approaching: false, overdue: false };
        }

        const status = notifiedRef.current[task.id];

        // approaching warning (between 0 and 15 mins left)
        if (diffMins > 0 && diffMins <= 15 && !status.approaching) {
           addToast(`⏳ Time is running out! "${task.title}" is due in ${Math.ceil(diffMins)} mins.`, 'warning');
           notifiedRef.current[task.id].approaching = true;
        }

        // overdue alert
        if (diffMs <= 0 && !status.overdue) {
           addToast(`🚨 Task Overdue: "${task.title}" is late!`, 'error');
           notifiedRef.current[task.id].overdue = true;
           // Reset approaching so if due date is pushed forward, it can warn again
           notifiedRef.current[task.id].approaching = true; 
        }
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await DjangoAPI.getTasks();
      setTasks(data);
    } catch (err) {
      console.error("Failed to fetch tasks", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // --- Live API Handlers (Preserved) ---
  const startLiveSession = async () => {
    setLiveError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      audioContextRef.current = outputCtx;
      let nextStartTime = 0;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: liveTools }],
          systemInstruction: {
             parts: [{ text: `You are TaskFlow AI, a real-time voice assistant. Current date and time: ${new Date().toLocaleString()}. You manage the user's tasks. Use delete_task to remove a specific task, or delete_completed_tasks to clean up finished items. Always confirm deletions.` }]
          }
        },
        callbacks: {
          onopen: () => {
            setIsLiveActive(true);
            const source = inputCtx.createMediaStreamSource(stream);
            inputSourceRef.current = source;
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBuffer = float32To16BitPCM(inputData);
              const base64Data = arrayBufferToBase64(pcmBuffer);
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({
                  media: { mimeType: 'audio/pcm;rate=16000', data: base64Data }
                });
              });
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              const float32Data = base64ToFloat32Array(audioData);
              const buffer = outputCtx.createBuffer(1, float32Data.length, 24000);
              buffer.getChannelData(0).set(float32Data);
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputCtx.destination);
              const now = outputCtx.currentTime;
              const startTime = Math.max(now, nextStartTime);
              source.start(startTime);
              nextStartTime = startTime + buffer.duration;
            }

            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                let result: any = { error: "Unknown function" };
                try {
                  switch (fc.name) {
                    case 'create_task':
                      const newTask = await DjangoAPI.createTask({
                        title: fc.args.title as string,
                        description: fc.args.description as string || '',
                        priority: (fc.args.priority as Priority) || 'Medium',
                        completed: false,
                        due_date: fc.args.due_date as string || ''
                      });
                      result = { success: true, task: newTask };
                      await loadTasks();
                      break;
                    case 'get_tasks':
                      const tasks = await DjangoAPI.getTasks();
                      result = { tasks: tasks.map(t => ({ id: t.id, title: t.title, priority: t.priority, completed: t.completed, due_date: t.due_date })) };
                      break;
                    case 'update_task_status':
                      await DjangoAPI.updateTask(fc.args.id as number, { completed: fc.args.completed as boolean });
                      result = { success: true };
                      await loadTasks();
                      break;
                    case 'delete_task':
                      await DjangoAPI.deleteTask(fc.args.id as number);
                      result = { success: true };
                      await loadTasks();
                      break;
                    case 'delete_completed_tasks':
                      const count = await DjangoAPI.deleteCompletedTasks();
                      result = { success: true, count };
                      await loadTasks();
                      break;
                  }
                } catch (e) {
                  result = { error: (e as Error).message };
                }
                sessionPromise.then(session => {
                  session.sendToolResponse({
                    functionResponses: { id: fc.id, name: fc.name, response: { result } }
                  });
                });
              }
            }
          },
          onclose: () => {
            setIsLiveActive(false);
            stopAudioProcessing();
          },
          onerror: (err) => {
            console.error(err);
            setLiveError("Connection error.");
            setIsLiveActive(false);
            stopAudioProcessing();
          }
        }
      });
    } catch (err) {
      console.error(err);
      setLiveError("Microphone access denied.");
    }
  };

  const stopAudioProcessing = () => {
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current.mediaStream.getTracks().forEach(t => t.stop());
    }
    if (processorRef.current) processorRef.current.disconnect();
    if (audioContextRef.current) audioContextRef.current.close();
  };

  const stopLiveSession = () => {
    setIsLiveActive(false);
    stopAudioProcessing();
    window.location.reload(); 
  };

  // --- Task Handlers ---

  const handleSave = async (data: Omit<Task, 'id' | 'created_at' | 'completed'>) => {
    if (editingTask) {
      const updated = await DjangoAPI.updateTask(editingTask.id, data);
      setTasks(tasks.map(t => t.id === updated.id ? updated : t));
    } else {
      const created = await DjangoAPI.createTask({ ...data, completed: false, priority: data.priority });
      setTasks([created, ...tasks]);
    }
  };

  const handleToggle = async (id: number, current: boolean) => {
    const updates: Partial<Task> = { 
      completed: !current,
      completed_at: !current ? new Date().toISOString() : undefined
    };
    
    setTasks(tasks.map(t => t.id === id ? { ...t, ...updates } : t));
    await DjangoAPI.updateTask(id, updates);
  };

  const handleDelete = async (id: number) => {
    // Functional update ensures we are filtering against the latest state
    // Removed native confirm to make the UI feel faster and more 'app-like' per request to allow user to delete easily.
    // If safety is needed, we could add an undo toast later.
    setTasks(prevTasks => prevTasks.filter(t => t.id !== id));
    
    try {
      await DjangoAPI.deleteTask(id);
    } catch (error) {
      console.error("Deletion failed:", error);
      // Ideally we would revert state here if it fails
    }
  };

  const handleClearCompleted = async () => {
    if (!confirm('Remove all completed tasks?')) return;
    await DjangoAPI.deleteCompletedTasks();
    await loadTasks();
  };

  const handleClearData = async () => {
    await DjangoAPI.clearDatabase();
    setTasks([]);
  };

  const openNew = () => {
    setEditingTask(undefined);
    setModalOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setModalOpen(true);
  };

  const filteredTasks = tasks.filter(t => {
    if (filter === 'active') return !t.completed;
    if (filter === 'completed') return t.completed;
    return true;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (a.completed && b.completed) return b.id - a.id;
    if (a.completed) return 1;
    if (b.completed) return -1;

    // Sort by due date (nearest/overdue first)
    if (a.due_date && b.due_date) {
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    }
    // Tasks with due dates come before tasks without
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    
    return b.id - a.id;
  });

  const stats = {
    total: tasks.length,
    completed: tasks.filter(t => t.completed).length,
    pending: tasks.filter(t => !t.completed).length
  };

  return (
    <div className="min-vh-100 d-flex flex-col bg-white">
      {/* Side Menu (Desktop) */}
      <SideMenu 
        isOpen={isMenuOpen} 
        onClose={() => setIsMenuOpen(false)} 
        currentView={currentView}
        onViewChange={setCurrentView}
      />
      
      {/* Toasts */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Navbar with Cool Gradient and Operations */}
      <nav className="navbar navbar-expand-lg navbar-gradient border-bottom sticky-top shadow-sm z-3 py-3 flex-column align-items-stretch">
        <div className="container-fluid container-lg d-flex justify-content-between align-items-center">
          {/* Left */}
          <div className="d-flex align-items-center gap-3">
             <button 
               onClick={() => setIsMenuOpen(true)}
               className="btn btn-glass rounded-circle p-2 d-flex align-items-center justify-content-center desktop-only"
               style={{width: '42px', height: '42px'}}
             >
               <Menu size={22} />
             </button>
             <a 
               className="navbar-brand d-flex align-items-center gap-2 fw-bold m-0 cursor-pointer" 
               onClick={() => setCurrentView('home')}
               style={{ fontSize: '1.25rem', letterSpacing: '-0.5px' }}
             >
               <ListTodo size={28} className="text-white" />
               <span className="d-none d-sm-inline">TaskFlow</span>
               <span className="d-inline d-sm-none">TaskFlow</span>
             </a>
          </div>
          
          {/* Right Button Group REMOVED as requested */}
        </div>

        {/* Operations Bar (Filters) - Inside Navbar for unified look */}
        {currentView === 'home' && (
          <div className="container-fluid container-lg mt-3 d-flex justify-content-center">
             <div className="nav-pill-scroll-container">
                <div className="nav-pill-glass">
                    {(['all', 'active', 'completed'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`nav-link-glass ${filter === f ? 'active' : ''}`}
                    >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                    ))}
                    {stats.completed > 0 && (
                    <>
                        <div className="border-start border-white border-opacity-25 mx-1 my-1"></div>
                        <button 
                        onClick={handleClearCompleted}
                        className="nav-link-glass d-flex align-items-center justify-content-center px-3"
                        title="Clear Completed"
                        >
                        <Archive size={16} />
                        </button>
                    </>
                    )}
                </div>
             </div>
          </div>
        )}
      </nav>

      {/* Main Content Area */}
      <div className="flex-grow-1 bg-light app-content">
        {currentView === 'home' && (
          <div className="container py-4" style={{ maxWidth: '800px' }}>
            
            {/* Header Section */}
            <div className="d-flex justify-content-between align-items-end mb-4">
              <div>
                <h6 className="text-uppercase text-muted small fw-bold mb-1">
                  {currentTime.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                </h6>
                <div className="d-flex align-items-baseline gap-2">
                    <h1 className="fw-bold text-dark display-6 mb-0">Good Day! 👋</h1>
                    <span className="text-muted fs-5 fw-light d-none d-sm-inline">
                        {currentTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>
              </div>
              <div className="text-end d-none d-sm-block">
                <p className="mb-0 text-muted">You have {stats.pending} pending tasks.</p>
              </div>
            </div>

            {/* Progress Card */}
            <div className="card border-0 shadow-sm bg-primary text-white mb-5 overflow-hidden position-relative rounded-4">
              <div className="card-body p-4 position-relative z-1">
                <div className="d-flex justify-content-between align-items-end mb-3">
                  <div>
                    <h2 className="display-4 fw-bold mb-0">{stats.completed}/{stats.total}</h2>
                    <p className="mb-0 opacity-75 fw-medium">Tasks Completed Today</p>
                  </div>
                  <div className="text-end">
                    <h3 className="mb-0 fw-bold">{stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%</h3>
                    <small className="opacity-75">Progress</small>
                  </div>
                </div>
                <div className="progress bg-white bg-opacity-25 rounded-pill" style={{ height: '8px' }}>
                   <div 
                     className="progress-bar bg-white rounded-pill" 
                     role="progressbar" 
                     style={{ width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%` }}
                   ></div>
                </div>
              </div>
              {/* Decorative Elements */}
            </div>

            {/* Live Error */}
            {liveError && (
              <div className="alert alert-danger rounded-3 border-0 shadow-sm d-flex align-items-center mb-4" role="alert">
                <Activity size={18} className="me-2" />
                {liveError}
              </div>
            )}

            {/* My Tasks Title (Filters moved to top) */}
            <div className="mb-3">
               <h5 className="fw-bold mb-0 text-dark">My Tasks</h5>
            </div>

            {/* Task List */}
            <div className="d-flex flex-column gap-3 pb-5">
                {isLoading ? (
                     <div className="text-center py-5 text-muted">
                       <Loader2 size={32} className="animate-spin mb-2" />
                       <p>Syncing...</p>
                     </div>
                ) : sortedTasks.length > 0 ? (
                     sortedTasks.map(task => (
                        <TaskCard 
                          key={task.id} 
                          task={task} 
                          onToggle={handleToggle}
                          onEdit={openEdit}
                          onDelete={handleDelete}
                        />
                     ))
                ) : (
                     <div className="text-center py-5 border rounded-4 border-dashed bg-white">
                        <div className="text-secondary mb-3 opacity-25"><ListTodo size={64} /></div>
                        <h5 className="fw-bold text-dark">No tasks found</h5>
                        {filter !== 'all' ? (
                           <p className="text-muted">No {filter} tasks available.</p>
                        ) : (
                           <div>
                             <p className="text-muted mb-3">Your list is empty. Start by adding a task!</p>
                             <button onClick={openNew} className="btn btn-primary rounded-pill px-4">Create Task</button>
                           </div>
                        )}
                     </div>
                )}
            </div>

          </div>
        )}

        {currentView === 'profile' && <ProfileView tasks={tasks} addToast={addToast} />}
        {currentView === 'settings' && <SettingsView onClearData={handleClearData} />}
        {currentView === 'feedback' && <FeedbackView />}
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav 
        currentView={currentView}
        onViewChange={setCurrentView}
        isLiveActive={isLiveActive}
        onToggleLive={isLiveActive ? stopLiveSession : startLiveSession}
      />
      
      {/* Mobile FAB */}
      {currentView === 'home' && (
        <button className="mobile-fab" onClick={openNew}>
            <Plus size={24} />
        </button>
      )}

      <TaskModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        onSave={handleSave} 
        initialData={editingTask} 
      />
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);