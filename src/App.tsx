import React, { useState, useEffect, useRef } from "react";
import { GoogleGenAI } from "@google/genai";
import { 
  Zap, 
  History, 
  Trash2, 
  X, 
  Clock, 
  ChevronRight, 
  ChevronLeft,
  Clipboard,
  CheckCircle,
  Loader2,
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  Settings,
  Plus,
  Sliders,
  Save,
  Map,
  Compass
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// --- Types ---
interface Dimension {
  id: string;
  label: string;
  description: string;
  weight: number;
}

interface EvaluationResult {
  [key: string]: any; // To handle dynamic dimension scores and rationales
  overall_score: number;
  grade: string;
  weakest_dimension: string;
  one_line_verdict: string;
  top_fix: string;
}

interface HistoryItem {
  id: string;
  timestamp: number;
  promptData: PromptData;
  result: EvaluationResult;
  dimensions: Dimension[];
}

interface PromptData {
  role: string;
  context: string;
  task: string;
  format: string;
  constraints: string;
  example: string;
}

const STEPS = [
  {
    id: "role",
    tag: "Step 1 of 6 · Role definition",
    title: "Who is speaking?",
    subtitle: "Assign a persona to the model before anything else.",
    why: "Every LLM response is shaped by an implicit speaker. Without a role, the model defaults to a generic assistant voice — shallow, hedged, and imprecise. When you define a role, you activate a specific slice of the model's knowledge and set the appropriate confidence level, vocabulary, and depth. Google's internal prompt guidelines list role definition as the single highest-leverage change for output quality.",
    example: "You are a senior backend engineer with 12 years of experience in distributed systems, specialising in Node.js and PostgreSQL.",
    placeholder: "You are a [job title / expert type] with [X years] of experience in [domain]...",
    chips: ['Senior software engineer', 'ML engineer (Python)', 'DevOps specialist', 'API architect', 'Security researcher'],
    roadmapTip: "Think of this as 'setting the stage'. A specific role unlocks expert-level vocabulary and reasoning patterns."
  },
  {
    id: "context",
    tag: "Step 2 of 6 · Context",
    title: "What's the situation?",
    subtitle: "Give the model the background it needs to act intelligently.",
    why: "Context is the information the model cannot infer from the task alone. Without it, the model fills gaps with generic assumptions — often wrong ones. Good context answers three questions: Who is the audience? What is the situation? What is the goal? Anthropic's prompt engineering research shows that context depth is the strongest predictor of output relevance.",
    example: "The user is a non-technical startup founder preparing for a Series A pitch. They have limited time and need to understand technical trade-offs without jargon.",
    placeholder: "The user is a [audience]. The situation is [background]. The goal is [purpose]...",
    chips: ['The user is a developer', 'The codebase uses Node.js', 'Target audience is non-technical', 'Production environment'],
    roadmapTip: "Answer: Who is this for? Why are we doing this? What is the starting point?"
  },
  {
    id: "task",
    tag: "Step 3 of 6 · Task",
    title: "What exactly must be done?",
    subtitle: "One clear verb-led instruction. The core of your prompt.",
    why: "The task instruction must start with an action verb — Analyse, Write, Compare, Extract, Classify, Summarise. Vague verbs like 'help with' or 'talk about' produce vague output. OpenAI's red-teaming team found that prompts with a single, specific primary instruction outperform multi-instruction prompts by ~40% on task completion.",
    example: "Review the following API design and identify the top 3 architectural weaknesses. For each, explain the risk and suggest a concrete fix.",
    placeholder: "[Action verb] the following [object] and [specific outcome]...",
    chips: ['Analyse and identify issues', 'Write a code review', 'Compare two approaches', 'Generate a test suite', 'Refactor for readability'],
    roadmapTip: "Start with a strong verb. Be singular in focus. What is the one thing the model MUST achieve?"
  },
  {
    id: "format",
    tag: "Step 4 of 6 · Output format",
    title: "What should the output look like?",
    subtitle: "Define the shape, structure, and length of the response.",
    why: "Without a format instruction, the model chooses its own structure — which may be completely incompatible with how you plan to use the output. If you are parsing the response in code, you need JSON. If a human reads it, you need headings and bullets. Microsoft's Prompt Engineering Guide notes that output format is the most commonly forgotten dimension.",
    example: "Respond as a JSON array. Each item should have: 'issue' (string), 'risk_level' (low/medium/high), and 'fix' (string). No explanation outside the JSON.",
    placeholder: "Respond as [format]. Structure your output as [shape]. Keep it under [X] words...",
    chips: ['Respond as JSON', 'Use numbered list', 'Plain prose, no markdown', 'Structured report with headings', 'Under 200 words'],
    roadmapTip: "Visualise the result. Do you need a table? JSON? A bulleted list? Be explicit about the structure."
  },
  {
    id: "constraints",
    tag: "Step 5 of 6 · Constraints",
    title: "What must the model avoid?",
    subtitle: "Guardrails prevent the most common failure modes.",
    why: "Constraints are the difference between a well-engineered prompt and a wish. Every model has default behaviours — adding caveats, repeating the question, using hedging language, generating more than asked. Constraints override those defaults explicitly. Anthropic's research shows that prompts with 2–4 explicit 'do not' constraints degrade significantly less across model versions.",
    example: "Do not repeat the question. Do not add caveats or disclaimers. Do not suggest further reading. If uncertain, say 'unclear' — do not guess.",
    placeholder: "Do not [X]. Avoid [Y]. Only [Z]. If [condition], then [instruction]...",
    chips: ['Do not repeat the question', 'Avoid jargon', 'No caveats or disclaimers', 'If uncertain, say so', 'One finding per point'],
    roadmapTip: "Set boundaries. What are the 'no-go' zones? This prevents generic AI 'fluff' and hedging."
  },
  {
    id: "example",
    tag: "Step 6 of 6 · One-shot example",
    title: "Show one sample output.",
    subtitle: "A single example calibrates tone, depth, and structure better than any description.",
    why: "This is called one-shot prompting — one of the most well-studied techniques in LLM research. Showing a single example of desired output reduces format errors by ~60% and dramatically improves tone consistency. For developers building AI pipelines, this is how you enforce an output contract without fine-tuning.",
    example: "Example output:\n[{\"issue\": \"No rate limiting on auth endpoint\", \"risk_level\": \"high\", \"fix\": \"Add token bucket algorithm with 10 req/min per IP\"}]",
    placeholder: "Example output:\n[paste what a perfect response would look like here]",
    chips: [],
    roadmapTip: "Show, don't just tell. A single sample output is worth 100 words of instruction."
  }
];

const DEFAULT_DIMENSIONS: Dimension[] = [
  { id: "clarity", label: "Clarity", description: "Is the instruction unambiguous and direct? Contradictory instructions score 16–25.", weight: 1 },
  { id: "specificity", label: "Specificity", description: "Does it include concrete details, numbers, or examples? Vague references score 20–35.", weight: 1 },
  { id: "role_definition", label: "Role Definition", description: "No role = 0. Implied role = 15–25. Named expert role = 60+.", weight: 1 },
  { id: "output_framing", label: "Output Framing", description: "Contradictory length instructions score 20–30. Clear format = 60+.", weight: 1 },
  { id: "context_depth", label: "Context Depth", description: "No context = 0–10. Topic present but no audience/purpose = 20–35.", weight: 1 },
  { id: "constraint_quality", label: "Constraint Quality", description: "Contradictory constraints score 15–25. Clear single constraint = 55+.", weight: 1 }
];

const getSystemInstruction = (dimensions: Dimension[]) => {
  const dimsList = dimensions.map(d => `- ${d.id}: ${d.description}`).join('\n');
  const rationalesList = dimensions.map(d => {
    let extra = "";
    if (d.id === "context_depth") extra = " For 'context_depth_rationale', specifically include examples of missing context (e.g., audience, background, or goal) that led to the score if it's not a perfect 100.";
    if (d.id === "output_framing") extra = " For 'output_framing_rationale', include specific examples of how the format was or was not clearly defined (e.g., JSON, markdown, length) and the impact on the score.";
    return `For '${d.id}', also provide a detailed "rationale" (20-30 words) explaining exactly why that score was given, highlighting both strengths and specific areas for improvement.${extra}`;
  }).join('\n');

  const jsonShape: Record<string, any> = {
    overall_score: 0,
    grade: "",
    weakest_dimension: "",
    one_line_verdict: "",
    top_fix: ""
  };
  dimensions.forEach(d => {
    jsonShape[d.id] = 0;
    jsonShape[`${d.id}_rationale`] = "";
  });

  return `You are a senior prompt engineering evaluator trained on industrial standards from Google, Anthropic, OpenAI, and Microsoft.

A student has submitted a prompt for grading. Your job is to evaluate it strictly and return ONLY a valid JSON object — no explanation, no markdown, no preamble, no code fences.

Score the prompt across these ${dimensions.length} dimensions, each from 0 to 100. Use the full range — partial credit matters. A prompt that ATTEMPTS a dimension but does it poorly should score 20–40, not 0.

Scoring guide per dimension:
- 0–15: completely absent
- 16–35: attempted but ineffective or contradictory
- 36–55: present but vague or incomplete
- 56–75: clear and functional
- 76–90: strong, specific, well-formed
- 91–100: exceptional, production-grade

Dimensions:
${dimsList}

${rationalesList}

Also return:
- overall_score: a weighted average of all dimensions based on their importance, rounded to nearest integer.
- grade: "Excellent" if >=85, "Good" if >=70, "Needs Work" if >=50, "Poor" if below 50
- weakest_dimension: name of the lowest-scoring dimension
- one_line_verdict: single sentence summarising the main problem or strength
- top_fix: single most impactful improvement, in one sentence

Return this exact JSON shape and nothing else:
${JSON.stringify(jsonShape)}`;
};

export default function App() {
  const [currentStep, setCurrentStep] = useState(0);
  const [promptData, setPromptData] = useState<PromptData>({
    role: "",
    context: "",
    task: "",
    format: "",
    constraints: "",
    example: ""
  });
  const [isGrading, setIsGrading] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [savedItems, setSavedItems] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyTab, setHistoryTab] = useState<"history" | "library">("history");
  const [dimensions, setDimensions] = useState<Dimension[]>(DEFAULT_DIMENSIONS);
  const [showSettings, setShowSettings] = useState(false);
  const [showRoadmap, setShowRoadmap] = useState(true);

  useEffect(() => {
    const savedHistory = localStorage.getItem("promptcraft_history");
    const savedLibrary = localStorage.getItem("promptcraft_library");
    const savedDimensions = localStorage.getItem("promptcraft_dimensions");
    
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
    if (savedLibrary) {
      try {
        setSavedItems(JSON.parse(savedLibrary));
      } catch (e) {
        console.error("Failed to parse library", e);
      }
    }
    if (savedDimensions) {
      try {
        setDimensions(JSON.parse(savedDimensions));
      } catch (e) {
        console.error("Failed to parse dimensions", e);
      }
    }
  }, []);

  const saveToHistory = (res: EvaluationResult) => {
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      promptData: { ...promptData },
      result: res,
      dimensions: [...dimensions]
    };
    const updated = [newItem, ...history].slice(0, 20);
    setHistory(updated);
    localStorage.setItem("promptcraft_history", JSON.stringify(updated));
  };

  const saveToLibrary = () => {
    if (!result) return;
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      promptData: { ...promptData },
      result: result,
      dimensions: [...dimensions]
    };
    const updated = [newItem, ...savedItems];
    setSavedItems(updated);
    localStorage.setItem("promptcraft_library", JSON.stringify(updated));
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent, type: "history" | "library") => {
    e.stopPropagation();
    if (type === "history") {
      const updated = history.filter(item => item.id !== id);
      setHistory(updated);
      localStorage.setItem("promptcraft_history", JSON.stringify(updated));
    } else {
      const updated = savedItems.filter(item => item.id !== id);
      setSavedItems(updated);
      localStorage.setItem("promptcraft_library", JSON.stringify(updated));
    }
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setPromptData(item.promptData);
    setResult(item.result);
    if (item.dimensions) {
      setDimensions(item.dimensions);
    }
    setShowHistory(false);
    setCurrentStep(STEPS.length - 1);
  };

  const handleInputChange = (field: keyof PromptData, value: string) => {
    setPromptData(prev => ({ ...prev, [field]: value }));
  };

  const insertChip = (field: keyof PromptData, text: string) => {
    handleInputChange(field, text);
  };

  const buildFullPrompt = () => {
    const { role, context, task, format, constraints, example } = promptData;
    let parts = [];
    if (role) parts.push(`## Role\n${role}`);
    if (context) parts.push(`## Context\n${context}`);
    if (task) parts.push(`## Task\n${task}`);
    if (format || constraints) {
      let req = [];
      if (format) req.push(format);
      if (constraints) req.push(constraints);
      parts.push(`## Output requirements\n${req.join('\n')}`);
    }
    if (example) parts.push(`## Example output\n${example}`);
    return parts.join('\n\n');
  };

  const gradePrompt = async () => {
    const fullPrompt = buildFullPrompt();
    if (!fullPrompt.trim()) {
      setError("Please fill in at least one field before grading.");
      return;
    }

    setIsGrading(true);
    setError(null);
    setResult(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: fullPrompt }] }],
        config: {
          systemInstruction: getSystemInstruction(dimensions),
          responseMimeType: "application/json",
        },
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from model");

      const parsed = JSON.parse(text) as EvaluationResult;
      
      // Recalculate overall score based on custom weights if needed
      const totalWeight = dimensions.reduce((acc, d) => acc + d.weight, 0);
      const weightedSum = dimensions.reduce((acc, d) => {
        const score = parsed[d.id] || 0;
        return acc + (score * d.weight);
      }, 0);
      
      const finalOverallScore = Math.round(weightedSum / totalWeight);
      parsed.overall_score = finalOverallScore;
      
      // Update grade based on new overall score
      if (finalOverallScore >= 85) parsed.grade = "Excellent";
      else if (finalOverallScore >= 70) parsed.grade = "Good";
      else if (finalOverallScore >= 50) parsed.grade = "Needs Work";
      else parsed.grade = "Poor";

      setResult(parsed);
      saveToHistory(parsed);
    } catch (err: any) {
      console.error("Grading error:", err);
      setError(err.message || "An unexpected error occurred during grading.");
    } finally {
      setIsGrading(false);
    }
  };

  const copyPrompt = () => {
    const txt = buildFullPrompt();
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetWizard = () => {
    if (confirm("Are you sure you want to restart? This will clear all current inputs.")) {
      setPromptData({
        role: "",
        context: "",
        task: "",
        format: "",
        constraints: "",
        example: ""
      });
      setCurrentStep(0);
      setResult(null);
      setError(null);
    }
  };

  const getScoreColorClass = (score: number) => {
    if (score >= 85) return "text-pc-accent2";
    if (score >= 70) return "text-blue-400";
    if (score >= 50) return "text-pc-amber";
    return "text-pc-red";
  };

  const getBarColor = (score: number) => {
    if (score >= 75) return "bg-pc-accent2";
    if (score >= 50) return "bg-pc-amber";
    return "bg-pc-red";
  };

  const step = STEPS[currentStep];

  return (
    <div className="min-h-screen flex flex-col items-center selection:bg-pc-accent selection:text-white">
      {/* TOP BAR */}
      <div className="w-full max-w-[1100px] flex items-center justify-between px-8 py-6 border-b border-pc-border">
        <div className="text-[15px] font-bold tracking-widest">
          PROMPTCRAFT<span className="text-pc-accent">CRAFT</span> <span className="text-pc-hint font-normal">/ builder</span>
        </div>
        
        <div className="flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <div 
              key={i}
              className={`h-2 rounded-full transition-all duration-300 border border-pc-border2 ${
                i < currentStep ? "w-2 bg-pc-accent2 border-pc-accent2" : 
                i === currentStep ? "w-[22px] bg-pc-accent border-pc-accent" : 
                "w-2 bg-pc-bg4"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowRoadmap(!showRoadmap)}
            className={`font-mono text-[11px] border rounded-md px-3 py-1.5 transition-all flex items-center gap-2 ${showRoadmap ? "bg-pc-accent/10 border-pc-accent text-pc-accent" : "text-pc-hint border-pc-border hover:border-pc-border2 hover:text-pc-muted"}`}
          >
            <Map size={14} /> roadmap
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="font-mono text-[11px] text-pc-hint border border-pc-border rounded-md px-3 py-1.5 hover:border-pc-border2 hover:text-pc-muted transition-all flex items-center gap-2"
          >
            <Sliders size={14} /> weights
          </button>
          <button 
            onClick={() => {
              setHistoryTab("history");
              setShowHistory(true);
            }}
            className="font-mono text-[11px] text-pc-hint border border-pc-border rounded-md px-3 py-1.5 hover:border-pc-border2 hover:text-pc-muted transition-all flex items-center gap-2"
          >
            <History size={14} /> history
          </button>
          <button 
            onClick={() => {
              setHistoryTab("library");
              setShowHistory(true);
            }}
            className="font-mono text-[11px] text-pc-hint border border-pc-border rounded-md px-3 py-1.5 hover:border-pc-border2 hover:text-pc-muted transition-all flex items-center gap-2"
          >
            <Bookmark size={14} /> library
          </button>
          <button 
            onClick={resetWizard}
            className="font-mono text-[11px] text-pc-hint border border-pc-border rounded-md px-3 py-1.5 hover:border-pc-border2 hover:text-pc-muted transition-all"
          >
            ↺ restart
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div className={`w-full max-w-[1200px] grid grid-cols-1 ${showRoadmap ? "lg:grid-cols-[220px_1fr_380px]" : "lg:grid-cols-[1fr_380px]"} flex-1 min-h-[calc(100vh-73px)] transition-all duration-300`}>
        
        {/* LEFT SIDEBAR: ROADMAP */}
        {showRoadmap && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="hidden lg:flex flex-col p-8 border-r border-pc-border bg-pc-bg2/50"
          >
            <div className="flex items-center gap-2 mb-8">
              <Compass size={16} className="text-pc-accent" />
              <h3 className="font-bold text-[11px] tracking-[0.2em] uppercase text-pc-text">Roadmap</h3>
            </div>
            
            <div className="relative space-y-10">
              {/* Vertical Connector */}
              <div className="absolute left-[11px] top-2 bottom-2 w-[1px] bg-pc-border2" />
              
              {STEPS.map((s, i) => {
                const isCompleted = !!promptData[s.id as keyof PromptData];
                const isActive = i === currentStep;
                const isPast = i < currentStep;
                
                return (
                  <button
                    key={s.id}
                    onClick={() => setCurrentStep(i)}
                    className="relative flex items-start gap-4 group text-left w-full"
                  >
                    <div className={`relative z-10 w-6 h-6 rounded-full border flex items-center justify-center transition-all duration-300 ${
                      isActive ? "bg-pc-accent border-pc-accent shadow-[0_0_15px_rgba(99,91,255,0.4)]" : 
                      isPast || isCompleted ? "bg-pc-accent2 border-pc-accent2" : 
                      "bg-pc-bg border-pc-border2 group-hover:border-pc-muted"
                    }`}>
                      {isPast || isCompleted ? (
                        <CheckCircle size={12} className="text-pc-bg" />
                      ) : (
                        <span className={`text-[9px] font-bold font-mono ${isActive ? "text-white" : "text-pc-hint"}`}>
                          0{i + 1}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex flex-col gap-0.5 flex-1">
                      <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${
                        isActive ? "text-pc-accent" : 
                        isPast || isCompleted ? "text-pc-text" : 
                        "text-pc-hint group-hover:text-pc-muted"
                      }`}>
                        {s.id}
                      </span>
                      <span className={`text-[9px] font-mono leading-tight transition-colors ${
                        isActive ? "text-pc-muted" : "text-pc-hint"
                      }`}>
                        {s.title}
                      </span>

                      {isActive && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          className="overflow-hidden"
                        >
                          <p className="text-[8px] text-pc-hint mt-2 leading-relaxed border-l border-pc-border2 pl-2">
                            {s.subtitle}
                          </p>
                          <div className="mt-2 bg-pc-bg border border-pc-border2 rounded p-2">
                             <span className="text-[7px] uppercase font-bold text-pc-accent block mb-1">Quick Example</span>
                             <span className="text-[8px] text-pc-muted font-mono line-clamp-3 italic leading-normal">
                               {s.example.length > 80 ? s.example.substring(0, 80) + "..." : s.example}
                             </span>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-auto pt-8">
              <div className="bg-pc-bg3 border border-pc-border2 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap size={14} className="text-pc-amber" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-pc-text">Pro Tip</span>
                </div>
                <p className="text-[10px] text-pc-hint font-mono leading-relaxed">
                  {(step as any).roadmapTip || step.why.split('.')[0] + '.'}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* CENTER: WIZARD */}
        <div className="p-10 lg:border-r border-pc-border flex flex-col">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col flex-1"
            >
              <div className="mb-6">
                <div className="font-mono text-[11px] text-pc-accent tracking-widest uppercase mb-2">
                  {step.tag}
                </div>
                <h2 className="text-3xl font-bold tracking-tight mb-1.5">
                  {step.title}
                </h2>
                <p className="text-[13px] text-pc-muted font-mono font-light">
                  {step.subtitle}
                </p>
              </div>

              <div className="bg-pc-bg2 border border-pc-border border-l-2 border-l-pc-accent rounded-r-lg p-5 mb-6">
                <div className="font-mono text-[10px] tracking-widest text-pc-accent uppercase mb-1.5">
                  Why this matters
                </div>
                <p className="text-[13px] text-pc-muted leading-relaxed font-mono font-light">
                  {step.why}
                </p>
              </div>

              <div className="bg-pc-bg3 border border-pc-border2 rounded-lg p-4 mb-6">
                <div className="font-mono text-[10px] text-pc-hint tracking-widest uppercase mb-1.5">
                  Example
                </div>
                <p className="text-[12px] text-pc-accent2 leading-relaxed font-mono">
                  {step.example}
                </p>
              </div>

              <div className="space-y-2">
                <div className="font-mono text-[11px] text-pc-muted tracking-widest uppercase">
                  {step.id === "example" ? "PASTE AN EXAMPLE OUTPUT (optional) →" : `DEFINE THE ${step.id.toUpperCase()} →`}
                </div>
                <textarea
                  value={promptData[step.id as keyof PromptData]}
                  onChange={(e) => handleInputChange(step.id as keyof PromptData, e.target.value)}
                  rows={step.id === "role" || step.id === "format" || step.id === "constraints" ? 3 : 4}
                  placeholder={step.placeholder}
                  className="w-full bg-pc-bg2 border border-pc-border2 rounded-lg p-4 font-mono text-[13px] text-pc-text outline-none focus:border-pc-accent transition-colors resize-none leading-relaxed"
                />
                
                {step.chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {step.chips.map((chip, i) => (
                      <button
                        key={i}
                        onClick={() => insertChip(step.id as keyof PromptData, chip)}
                        className="font-mono text-[11px] px-2.5 py-1 rounded-md border border-pc-border2 text-pc-muted hover:border-pc-accent hover:text-pc-accent hover:bg-pc-accent/5 transition-all"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-auto pt-8 flex items-center justify-between">
                {currentStep > 0 ? (
                  <button 
                    onClick={() => setCurrentStep(prev => prev - 1)}
                    className="font-mono text-[12px] text-pc-muted hover:text-pc-text transition-colors"
                  >
                    ← Back
                  </button>
                ) : <div />}

                {currentStep < STEPS.length - 1 ? (
                  <button 
                    onClick={() => setCurrentStep(prev => prev + 1)}
                    className="bg-pc-accent text-white font-medium text-[13px] px-7 py-2.5 rounded-lg hover:bg-[#5a52e0] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2"
                  >
                    Next — {STEPS[currentStep + 1].id.charAt(0).toUpperCase() + STEPS[currentStep + 1].id.slice(1)} →
                  </button>
                ) : (
                  <button 
                    onClick={gradePrompt}
                    disabled={isGrading}
                    className="bg-pc-accent2 text-pc-bg font-medium text-[13px] px-7 py-2.5 rounded-lg hover:bg-[#22c55e] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {isGrading ? "Grading..." : "Grade my prompt ↗"}
                  </button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* RIGHT: PREVIEW + SCORE */}
        <div className="bg-pc-bg2 p-8 flex flex-col gap-5">
          <div className="font-mono text-[10px] tracking-widest text-pc-hint uppercase">
            // live prompt preview
          </div>

          <div className="bg-pc-bg border border-pc-border rounded-xl p-5 flex-1 overflow-y-auto max-h-[400px] lg:max-h-none">
            {STEPS.map((s, i) => {
              const val = promptData[s.id as keyof PromptData];
              if (s.id === "example" && !val) return null;
              
              return (
                <div key={s.id} className="mb-4 animate-fade-in">
                  <div className="font-mono text-[10px] text-pc-accent tracking-widest uppercase mb-1">
                    ## {s.id === "format" ? "Output format" : s.id === "example" ? "Example output" : s.id.charAt(0).toUpperCase() + s.id.slice(1)}
                  </div>
                  <div className={`font-mono text-[12px] leading-relaxed whitespace-pre-wrap ${!val ? "text-pc-hint italic" : "text-pc-text"}`}>
                    {val || `waiting for step ${i + 1}...`}
                  </div>
                </div>
              );
            })}
          </div>

          <button 
            onClick={copyPrompt}
            className="self-end font-mono text-[10px] text-pc-hint border border-pc-border rounded-md px-2 py-1 hover:border-pc-accent hover:text-pc-accent transition-all"
          >
            {copied ? "copied!" : "copy prompt"}
          </button>

          {/* SCORE PANEL */}
          <AnimatePresence>
            {isGrading && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 font-mono text-[12px] text-pc-muted py-2"
              >
                <div className="w-3.5 h-3.5 border-2 border-pc-border2 border-t-pc-accent rounded-full animate-pc-spin" />
                <span>Gemini is grading...</span>
              </motion.div>
            )}

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 bg-pc-red/10 border border-pc-red/20 text-pc-red rounded-lg text-[11px] font-mono flex items-start gap-2"
              >
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                {error}
              </motion.div>
            )}

            {result && !isGrading && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-pc-bg3 border border-pc-border rounded-xl p-5 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-bold font-mono leading-none ${getScoreColorClass(result.overall_score)}`}>
                      {result.overall_score}
                    </span>
                    <span className="text-[13px] font-mono text-pc-muted">
                      / 100 · {result.grade}
                    </span>
                  </div>
                  <button
                    onClick={saveToLibrary}
                    className="flex items-center gap-1.5 font-mono text-[10px] text-pc-accent border border-pc-accent/20 px-2.5 py-1.5 rounded-lg hover:bg-pc-accent/10 transition-all"
                  >
                    <Bookmark size={12} /> Save to Library
                  </button>
                </div>

                <div className="space-y-4">
                  {dimensions.map((dim) => (
                    <div key={dim.id} className="space-y-1.5">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="text-pc-muted">{dim.label}</span>
                        <span className="text-pc-text">{result[dim.id]}</span>
                      </div>
                      <div className="h-[3px] bg-pc-bg4 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${result[dim.id]}%` }}
                          transition={{ duration: 0.8, ease: "easeOut" }}
                          className={`h-full rounded-full ${getBarColor(result[dim.id] as number)}`}
                        />
                      </div>
                      <div className="bg-pc-bg4/30 rounded p-2 mt-1">
                        <div className="text-[9px] font-bold text-pc-hint uppercase tracking-wider mb-1">Feedback</div>
                        <p className="text-[11px] text-pc-muted font-mono leading-relaxed">
                          {result[`${dim.id}_rationale`]}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-pc-bg2 border-l-2 border-l-pc-amber rounded-r-md p-3">
                  <div className="font-mono text-[10px] text-pc-amber tracking-widest uppercase mb-1">
                    Verdict
                  </div>
                  <p className="font-mono text-[11px] text-pc-muted leading-relaxed">
                    {result.one_line_verdict}
                  </p>
                </div>

                <div className="bg-pc-bg2 border-l-2 border-l-pc-accent2 rounded-r-md p-3">
                  <div className="font-mono text-[10px] text-pc-accent2 tracking-widest uppercase mb-1">
                    Top fix
                  </div>
                  <p className="font-mono text-[11px] text-pc-muted leading-relaxed">
                    {result.top_fix}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* HISTORY MODAL */}
      <AnimatePresence>
        {showHistory && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-pc-bg/80 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-2xl bg-pc-bg2 border border-pc-border rounded-2xl shadow-2xl flex flex-col max-h-[80vh]"
            >
              <div className="flex items-center justify-between p-6 border-b border-pc-border">
                <div className="flex items-center gap-6">
                  <button 
                    onClick={() => setHistoryTab("history")}
                    className={`flex items-center gap-2 pb-1 border-b-2 transition-all ${historyTab === "history" ? "border-pc-accent text-pc-text" : "border-transparent text-pc-hint hover:text-pc-muted"}`}
                  >
                    <History size={18} />
                    <span className="text-lg font-bold">History</span>
                  </button>
                  <button 
                    onClick={() => setHistoryTab("library")}
                    className={`flex items-center gap-2 pb-1 border-b-2 transition-all ${historyTab === "library" ? "border-pc-accent text-pc-text" : "border-transparent text-pc-hint hover:text-pc-muted"}`}
                  >
                    <Bookmark size={18} />
                    <span className="text-lg font-bold">Library</span>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {((historyTab === "history" && history.length > 0) || (historyTab === "library" && savedItems.length > 0)) && (
                    <button 
                      onClick={() => {
                        if (confirm(`Clear all ${historyTab}?`)) {
                          if (historyTab === "history") {
                            setHistory([]);
                            localStorage.removeItem("promptcraft_history");
                          } else {
                            setSavedItems([]);
                            localStorage.removeItem("promptcraft_library");
                          }
                        }
                      }}
                      className="font-mono text-[10px] text-pc-red border border-pc-red/20 px-2 py-1 rounded hover:bg-pc-red/10 transition-all"
                    >
                      clear all
                    </button>
                  )}
                  <button 
                    onClick={() => setShowHistory(false)}
                    className="p-2 hover:bg-pc-bg3 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {historyTab === "history" ? (
                  history.length === 0 ? (
                    <div className="text-center py-12 text-pc-hint font-mono text-[13px]">
                      No evaluations yet. Grade a prompt to see it here.
                    </div>
                  ) : (
                    history.map((item) => (
                      <div 
                        key={item.id}
                        onClick={() => loadHistoryItem(item)}
                        className="group bg-pc-bg3 border border-pc-border2 rounded-xl p-4 hover:border-pc-accent transition-all cursor-pointer relative"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className={`text-xl font-bold font-mono ${getScoreColorClass(item.result.overall_score)}`}>
                              {item.result.overall_score}
                            </span>
                            <div className="flex flex-col">
                              <span className="text-[12px] font-bold">{item.result.grade}</span>
                              <span className="text-[10px] text-pc-hint font-mono">
                                {new Date(item.timestamp).toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <button 
                            onClick={(e) => deleteHistoryItem(item.id, e, "history")}
                            className="p-2 text-pc-hint hover:text-pc-red hover:bg-pc-red/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <p className="text-[11px] text-pc-muted font-mono line-clamp-2 italic">
                          "{item.result.one_line_verdict}"
                        </p>
                      </div>
                    ))
                  )
                ) : (
                  savedItems.length === 0 ? (
                    <div className="text-center py-12 text-pc-hint font-mono text-[13px]">
                      Your library is empty. Save an evaluation to see it here.
                    </div>
                  ) : (
                    savedItems.map((item) => (
                      <div 
                        key={item.id}
                        onClick={() => loadHistoryItem(item)}
                        className="group bg-pc-bg3 border border-pc-border2 rounded-xl p-4 hover:border-pc-accent transition-all cursor-pointer relative"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className={`text-xl font-bold font-mono ${getScoreColorClass(item.result.overall_score)}`}>
                              {item.result.overall_score}
                            </span>
                            <div className="flex flex-col">
                              <span className="text-[12px] font-bold">{item.result.grade}</span>
                              <span className="text-[10px] text-pc-hint font-mono">
                                {new Date(item.timestamp).toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <button 
                            onClick={(e) => deleteHistoryItem(item.id, e, "library")}
                            className="p-2 text-pc-hint hover:text-pc-red hover:bg-pc-red/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <p className="text-[11px] text-pc-muted font-mono line-clamp-2 italic">
                          "{item.result.one_line_verdict}"
                        </p>
                      </div>
                    ))
                  )
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-pc-bg/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-2xl bg-pc-bg2 border border-pc-border rounded-2xl shadow-2xl flex flex-col max-h-[80vh] relative z-10"
            >
              <div className="flex items-center justify-between p-6 border-b border-pc-border">
                <div className="flex items-center gap-2">
                  <Sliders className="text-pc-accent" size={20} />
                  <h3 className="text-xl font-bold">Scoring Dimensions & Weights</h3>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-pc-bg3 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <p className="text-[13px] text-pc-muted leading-relaxed">
                  Customise how your prompts are graded. Adjust weights to prioritise certain aspects, or add your own custom criteria.
                </p>

                <div className="space-y-4">
                  {dimensions.map((dim, index) => (
                    <div key={dim.id} className="bg-pc-bg3 border border-pc-border2 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <input 
                          type="text"
                          value={dim.label}
                          onChange={(e) => {
                            const updated = [...dimensions];
                            updated[index].label = e.target.value;
                            setDimensions(updated);
                          }}
                          className="bg-transparent font-bold text-sm focus:outline-none border-b border-transparent focus:border-pc-accent transition-all"
                          placeholder="Dimension Name"
                        />
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 bg-pc-bg border border-pc-border rounded-lg px-2 py-1">
                            <span className="text-[10px] font-mono text-pc-hint uppercase">Weight</span>
                            <input 
                              type="number"
                              min="0"
                              max="10"
                              value={dim.weight}
                              onChange={(e) => {
                                const updated = [...dimensions];
                                updated[index].weight = Number(e.target.value);
                                setDimensions(updated);
                              }}
                              className="bg-transparent font-mono text-xs w-8 text-center focus:outline-none"
                            />
                          </div>
                          <button 
                            onClick={() => {
                              const updated = dimensions.filter((_, i) => i !== index);
                              setDimensions(updated);
                            }}
                            className="p-1.5 text-pc-hint hover:text-pc-red transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <textarea 
                        value={dim.description}
                        onChange={(e) => {
                          const updated = [...dimensions];
                          updated[index].description = e.target.value;
                          setDimensions(updated);
                        }}
                        className="w-full bg-transparent text-[11px] text-pc-muted focus:outline-none resize-none min-h-[40px]"
                        placeholder="What does a high score in this dimension look like?"
                      />
                    </div>
                  ))}
                </div>

                <button 
                  onClick={() => {
                    const id = `custom_${Date.now()}`;
                    setDimensions([...dimensions, { id, label: "New Dimension", description: "Describe the criteria...", weight: 1 }]);
                  }}
                  className="w-full py-3 border border-dashed border-pc-border2 rounded-xl text-pc-hint hover:text-pc-muted hover:border-pc-border transition-all flex items-center justify-center gap-2 font-mono text-xs"
                >
                  <Plus size={14} /> add custom dimension
                </button>
              </div>

              <div className="p-6 border-t border-pc-border flex justify-between gap-4">
                <button 
                  onClick={() => {
                    if (confirm("Reset to default dimensions?")) {
                      setDimensions(DEFAULT_DIMENSIONS);
                      localStorage.setItem("promptcraft_dimensions", JSON.stringify(DEFAULT_DIMENSIONS));
                    }
                  }}
                  className="px-4 py-2 text-pc-hint hover:text-pc-muted font-mono text-xs transition-all"
                >
                  reset to defaults
                </button>
                <button 
                  onClick={() => {
                    localStorage.setItem("promptcraft_dimensions", JSON.stringify(dimensions));
                    setShowSettings(false);
                  }}
                  className="px-6 py-2 bg-pc-accent text-pc-bg font-bold rounded-xl hover:opacity-90 transition-all flex items-center gap-2"
                >
                  <Save size={16} /> Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
