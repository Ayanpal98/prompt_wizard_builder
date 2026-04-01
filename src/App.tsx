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
  Compass,
  Play,
  Terminal,
  Variable,
  Layers,
  HelpCircle,
  Copy,
  RotateCcw,
  Brain,
  Shield
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import * as Diff from "diff";

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
  versions?: { 
    id: string;
    timestamp: number; 
    promptData: PromptData; 
    result: EvaluationResult;
    dimensions: Dimension[];
  }[];
}

interface PromptData {
  role: string;
  context: string;
  task: string;
  format: string;
  constraints: string;
  example: string;
}

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  data: PromptData;
  versions?: {
    id: string;
    timestamp: number;
    data: PromptData;
  }[];
}

interface TestCase {
  id: string;
  variables: Record<string, string>;
  expectedOutput: string;
  output: string;
  showDiff: boolean;
  isLoading: boolean;
  error: string | null;
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

const PREDEFINED_TEMPLATES: PromptTemplate[] = [
  {
    id: "summarization",
    name: "Executive Summariser",
    description: "Condense complex documents into actionable executive summaries.",
    category: "General",
    data: {
      role: "You are a Chief of Staff at a Fortune 500 company, known for your ability to distill complex information into brief, high-impact executive summaries.",
      context: "The user is a busy CEO who needs to understand the core message, key risks, and required actions from a long report or meeting transcript.",
      task: "Summarise the provided text into a 3-part executive brief.",
      format: "Use three sections: 1. Core Message (1 sentence), 2. Key Insights (3-5 bullets), 3. Required Actions (numbered list). Total length under 250 words.",
      constraints: "Do not use corporate jargon. Do not repeat the input. Avoid passive voice. If the input is missing actionable data, state 'No clear actions identified'.",
      example: "Core Message: The Q3 expansion into APAC is delayed by 4 weeks due to regulatory hurdles in Singapore.\n\nKey Insights:\n- Licensing approval is pending final audit.\n- Budget remains within 5% of forecast.\n- Local hiring is 80% complete.\n\nRequired Actions:\n1. Approve the revised timeline.\n2. Schedule a follow-up with the Singapore legal team."
    }
  },
  {
    id: "code-gen",
    name: "Clean Code Architect",
    description: "Generate production-ready, well-documented code following best practices.",
    category: "Coding",
    data: {
      role: "You are a Principal Software Engineer and Clean Code advocate. You prioritise readability, maintainability, and robust error handling.",
      context: "The user is building a scalable web application and needs a specific component or function implemented using modern industry standards.",
      task: "Write a high-quality implementation for the requested feature.",
      format: "Provide the code in a single block. Use clear variable names and JSDoc comments. Include a brief 'Implementation Notes' section at the end.",
      constraints: "Do not provide conversational filler. Do not use deprecated libraries. Ensure the code is type-safe. If the request is ambiguous, add a comment explaining your assumptions.",
      example: "/**\n * Calculates the Fibonacci sequence up to n.\n * @param {number} n - The number of elements.\n * @returns {number[]} The sequence.\n */\nfunction fib(n) { ... }"
    }
  },
  {
    id: "creative-writing",
    name: "Narrative Architect",
    description: "Craft compelling stories with rich character development and atmosphere.",
    category: "Writing",
    data: {
      role: "You are an award-winning novelist known for atmospheric prose and deep psychological character studies.",
      context: "The user provides a prompt or a scene idea and wants a high-quality narrative expansion that feels immersive and emotionally resonant.",
      task: "Write a compelling scene based on the provided prompt.",
      format: "Use standard literary prose. Focus on sensory details (sight, sound, smell). Keep the length between 400-600 words.",
      constraints: "Show, don't tell. Avoid cliches. Do not use adverbs where a stronger verb would suffice. Ensure the dialogue feels natural and subtext-heavy.",
      example: "The rain didn't just fall; it reclaimed the city. Elias stood at the window, the glass cold against his forehead..."
    }
  },
  {
    id: "data-extraction",
    name: "Structured Data Extractor",
    description: "Extract specific entities and relationships into clean JSON format.",
    category: "Data",
    data: {
      role: "You are a precision data extraction engine designed to convert unstructured text into valid, schema-compliant JSON.",
      context: "The user has a collection of raw text (emails, invoices, articles) and needs specific data points extracted for a database.",
      task: "Extract the requested entities from the provided text.",
      format: "Respond ONLY with a valid JSON object. Do not include markdown code blocks or any text before/after the JSON.",
      constraints: "If a field is missing, use null. Do not guess or hallucinate data. Ensure all dates are in ISO 8601 format.",
      example: "{\n  \"name\": \"John Doe\",\n  \"amount\": 150.00,\n  \"date\": \"2024-03-15\"\n}"
    }
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
  const [showTemplates, setShowTemplates] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualTab, setManualTab] = useState<"guide" | "roadmap">("guide");
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeItemType, setActiveItemType] = useState<"history" | "library" | "template" | null>(null);
  const [customTemplates, setCustomTemplates] = useState<PromptTemplate[]>([]);
  const [view, setView] = useState<"builder" | "tester">("builder");
  const [testCases, setTestCases] = useState<TestCase[]>([
    { id: crypto.randomUUID(), variables: {}, expectedOutput: "", output: "", showDiff: true, isLoading: false, error: null }
  ]);

  useEffect(() => {
    const savedHistory = localStorage.getItem("promptcraft_history");
    const savedLibrary = localStorage.getItem("promptcraft_library");
    const savedDimensions = localStorage.getItem("promptcraft_dimensions");
    const savedCustomTemplates = localStorage.getItem("promptcraft_custom_templates");
    
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
    if (savedCustomTemplates) {
      try {
        setCustomTemplates(JSON.parse(savedCustomTemplates));
      } catch (e) {
        console.error("Failed to parse custom templates", e);
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

    if (activeItemId && activeItemType === "library") {
      const existingIndex = savedItems.findIndex(i => i.id === activeItemId);
      if (existingIndex !== -1) {
        const existing = savedItems[existingIndex];
        const oldVersion = {
          id: crypto.randomUUID(),
          timestamp: existing.timestamp,
          promptData: existing.promptData,
          result: existing.result,
          dimensions: existing.dimensions
        };
        
        const updatedItem: HistoryItem = {
          ...existing,
          timestamp: Date.now(),
          promptData: { ...promptData },
          result: result,
          dimensions: [...dimensions],
          versions: [oldVersion, ...(existing.versions || [])].slice(0, 10) // Keep last 10 versions
        };
        
        const updated = [...savedItems];
        updated[existingIndex] = updatedItem;
        setSavedItems(updated);
        localStorage.setItem("promptcraft_library", JSON.stringify(updated));
        return;
      }
    }

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
    setActiveItemId(newItem.id);
    setActiveItemType("library");
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

  const loadHistoryItem = (item: any, type: "history" | "library" | "template") => {
    const data = item.promptData || item.data;
    if (!data) return;
    
    setPromptData(data);
    setActiveItemId(item.id);
    setActiveItemType(type);

    if ('result' in item && item.result) {
      setResult(item.result);
      setCurrentStep(STEPS.length - 1);
    } else {
      setResult(null);
      setCurrentStep(0);
    }
    if (item.dimensions) {
      setDimensions(item.dimensions);
    }
    setShowHistory(false);
    setShowTemplates(false);
  };

  const saveAsTemplate = (name: string, description: string) => {
    if (activeItemId && activeItemType === "template") {
      const existingIndex = customTemplates.findIndex(t => t.id === activeItemId);
      if (existingIndex !== -1) {
        const existing = customTemplates[existingIndex];
        const oldVersion = {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          data: existing.data
        };
        
        const updatedTemplate: PromptTemplate = {
          ...existing,
          name,
          description,
          data: { ...promptData },
          versions: [oldVersion, ...(existing.versions || [])].slice(0, 10)
        };
        
        const updated = [...customTemplates];
        updated[existingIndex] = updatedTemplate;
        setCustomTemplates(updated);
        localStorage.setItem("promptcraft_custom_templates", JSON.stringify(updated));
        return;
      }
    }

    const newTemplate: PromptTemplate = {
      id: crypto.randomUUID(),
      name,
      description,
      category: "General",
      data: { ...promptData }
    };
    const updated = [...customTemplates, newTemplate];
    setCustomTemplates(updated);
    localStorage.setItem("promptcraft_custom_templates", JSON.stringify(updated));
    setActiveItemId(newTemplate.id);
    setActiveItemType("template");
  };

  const deleteCustomTemplate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = customTemplates.filter(t => t.id !== id);
    setCustomTemplates(updated);
    localStorage.setItem("promptcraft_custom_templates", JSON.stringify(updated));
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
      setActiveItemId(null);
      setActiveItemType(null);
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

  const detectVariables = (text: string) => {
    const regex = /\{\{(.*?)\}\}/g;
    const matches = text.match(regex);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, "").trim()))];
  };

  const runTest = async (testCaseId: string) => {
    const fullPrompt = buildFullPrompt();
    const variables = detectVariables(fullPrompt);
    const testCase = testCases.find(tc => tc.id === testCaseId);
    if (!testCase) return;

    setTestCases(prev => prev.map(tc => tc.id === testCaseId ? { ...tc, isLoading: true, error: null } : tc));

    let finalPrompt = fullPrompt;
    variables.forEach(v => {
      const val = testCase.variables[v] || `[${v}]`;
      finalPrompt = finalPrompt.replace(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`, 'g'), val);
    });

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: finalPrompt }] }],
      });

      const text = response.text;
      setTestCases(prev => prev.map(tc => tc.id === testCaseId ? { ...tc, output: text || "", isLoading: false } : tc));
    } catch (err: any) {
      console.error("Test error:", err);
      setTestCases(prev => prev.map(tc => tc.id === testCaseId ? { ...tc, error: err.message || "Execution failed", isLoading: false } : tc));
    }
  };

  const addTestCase = () => {
    setTestCases(prev => [...prev, { id: crypto.randomUUID(), variables: {}, expectedOutput: "", output: "", showDiff: true, isLoading: false, error: null }]);
  };

  const removeTestCase = (id: string) => {
    if (testCases.length <= 1) return;
    setTestCases(prev => prev.filter(tc => tc.id !== id));
  };

  const updateTestCaseVariable = (id: string, variable: string, value: string) => {
    setTestCases(prev => prev.map(tc => tc.id === id ? { ...tc, variables: { ...tc.variables, [variable]: value } } : tc));
  };

  const updateTestCaseExpected = (id: string, value: string) => {
    setTestCases(prev => prev.map(tc => tc.id === id ? { ...tc, expectedOutput: value } : tc));
  };

  const toggleTestCaseDiff = (id: string) => {
    setTestCases(prev => prev.map(tc => tc.id === id ? { ...tc, showDiff: !tc.showDiff } : tc));
  };

  const runAllTests = async () => {
    const activeTests = testCases.filter(tc => !tc.isLoading);
    await Promise.all(activeTests.map(tc => runTest(tc.id)));
  };

  const step = STEPS[currentStep];

  const DiffViewer = ({ expected, actual }: { expected: string; actual: string }) => {
    if (!actual) return null;
    if (!expected) return <div className="whitespace-pre-wrap">{actual}</div>;

    const diff = Diff.diffWordsWithSpace(expected, actual);

    return (
      <div className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed">
        {diff.map((part, index) => {
          const color = part.added 
            ? 'bg-pc-accent2/20 text-pc-accent2' 
            : part.removed 
              ? 'bg-pc-red/20 text-pc-red line-through' 
              : 'text-pc-text';
          return (
            <span key={index} className={color}>
              {part.value}
            </span>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col items-center selection:bg-pc-accent selection:text-white">
      {/* TOP BAR */}
      <div className="w-full max-w-[1100px] flex items-center justify-between px-8 py-6 border-b border-pc-border">
        <div className="text-[15px] font-bold tracking-widest">
          WIZARD<span className="text-pc-accent">PROMPT</span> <span className="text-pc-hint font-normal">/ builder</span>
        </div>
        
        <div className="flex items-center gap-1.5">
          <button 
            onClick={() => setView("builder")}
            className={`px-4 py-1.5 rounded-lg font-mono text-[11px] transition-all flex items-center gap-2 ${view === "builder" ? "bg-pc-accent text-white shadow-lg" : "text-pc-hint hover:text-pc-muted"}`}
          >
            <Layers size={14} /> builder
          </button>
          <button 
            onClick={() => setView("tester")}
            className={`px-4 py-1.5 rounded-lg font-mono text-[11px] transition-all flex items-center gap-2 ${view === "tester" ? "bg-pc-accent text-white shadow-lg" : "text-pc-hint hover:text-pc-muted"}`}
          >
            <Terminal size={14} /> tester
          </button>
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
            onClick={() => setShowTemplates(true)}
            className="font-mono text-[11px] text-pc-hint border border-pc-border rounded-md px-3 py-1.5 hover:border-pc-border2 hover:text-pc-muted transition-all flex items-center gap-2"
          >
            <Zap size={14} /> templates
          </button>
          <button 
            onClick={() => setShowManual(true)}
            className="font-mono text-[11px] text-pc-hint border border-pc-border rounded-md px-3 py-1.5 hover:border-pc-border2 hover:text-pc-muted transition-all flex items-center gap-2"
          >
            <Compass size={14} /> guide & roadmap
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
      <div className={`w-full max-w-[1200px] flex-1 min-h-[calc(100vh-73px)] transition-all duration-300`}>
        {view === "builder" ? (
          <div className={`grid grid-cols-1 ${showRoadmap ? "lg:grid-cols-[220px_1fr_380px]" : "lg:grid-cols-[1fr_380px]"} h-full`}>
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

              <div className="flex items-center justify-end gap-2">
                <button 
                  onClick={() => {
                    const name = prompt("Enter a name for this template:");
                    if (name) saveAsTemplate(name, "Custom template");
                  }}
                  className="font-mono text-[10px] text-pc-hint border border-pc-border rounded-md px-2 py-1 hover:border-pc-accent hover:text-pc-accent transition-all flex items-center gap-1.5"
                >
                  <Zap size={10} /> save as template
                </button>
                <button 
                  onClick={copyPrompt}
                  className="font-mono text-[10px] text-pc-hint border border-pc-border rounded-md px-2 py-1 hover:border-pc-accent hover:text-pc-accent transition-all"
                >
                  {copied ? "copied!" : "copy prompt"}
                </button>
              </div>

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
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-10 flex flex-col gap-8"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold tracking-tight mb-1.5 flex items-center gap-3">
                  <Terminal className="text-pc-accent" /> Prompt Tester
                </h2>
                <p className="text-[13px] text-pc-muted font-mono font-light">
                  Execute your prompt with different variables to verify performance.
                </p>
              </div>
              <button 
                onClick={addTestCase}
                className="bg-pc-bg3 border border-pc-border2 text-pc-text font-mono text-[12px] px-4 py-2 rounded-lg hover:border-pc-accent transition-all flex items-center gap-2"
              >
                <Plus size={14} /> Add Test Case
              </button>
              <button 
                onClick={runAllTests}
                disabled={testCases.some(tc => tc.isLoading)}
                className="bg-pc-accent text-white font-mono text-[12px] px-4 py-2 rounded-lg hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                <Play size={14} /> Run All Tests
              </button>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[400px_1fr] gap-8">
              {/* PROMPT PREVIEW */}
              <div className="space-y-4">
                <div className="font-mono text-[10px] tracking-widest text-pc-hint uppercase flex items-center justify-between">
                  <span>Current Prompt</span>
                  <button onClick={copyPrompt} className="hover:text-pc-accent transition-colors flex items-center gap-1">
                    <Copy size={10} /> copy
                  </button>
                </div>
                <div className="bg-pc-bg2 border border-pc-border rounded-xl p-5 font-mono text-[12px] text-pc-muted whitespace-pre-wrap max-h-[600px] overflow-y-auto leading-relaxed">
                  {buildFullPrompt() || "No prompt content yet. Go back to builder to add details."}
                </div>
                
                {detectVariables(buildFullPrompt()).length > 0 && (
                  <div className="bg-pc-accent/5 border border-pc-accent/20 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Variable size={14} className="text-pc-accent" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-pc-accent">Detected Variables</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {detectVariables(buildFullPrompt()).map(v => (
                        <span key={v} className="bg-pc-bg3 border border-pc-border2 px-2 py-1 rounded text-[10px] font-mono text-pc-text">
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* TEST CASES */}
              <div className="space-y-6">
                {testCases.map((tc, idx) => {
                  const vars = detectVariables(buildFullPrompt());
                  return (
                    <div key={tc.id} className="bg-pc-bg2 border border-pc-border rounded-2xl overflow-hidden shadow-sm">
                      <div className="bg-pc-bg3 px-6 py-3 border-b border-pc-border flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="bg-pc-accent text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono">
                            {idx + 1}
                          </span>
                          <span className="font-bold text-[12px] uppercase tracking-widest">Test Case</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => runTest(tc.id)}
                            disabled={tc.isLoading}
                            className="bg-pc-accent text-white font-mono text-[11px] px-4 py-1.5 rounded-lg hover:opacity-90 transition-all flex items-center gap-2 disabled:opacity-50"
                          >
                            {tc.isLoading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                            {tc.isLoading ? "Running..." : "Run Test"}
                          </button>
                          <button 
                            onClick={() => removeTestCase(tc.id)}
                            className="p-1.5 text-pc-hint hover:text-pc-red transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* INPUTS */}
                        <div className="space-y-4">
                          <div className="font-mono text-[10px] tracking-widest text-pc-hint uppercase">Inputs</div>
                          {vars.length === 0 ? (
                            <div className="text-[11px] text-pc-hint font-mono italic p-4 bg-pc-bg/50 border border-dashed border-pc-border2 rounded-lg">
                              No variables detected. Use {"{{variable}}"} syntax in your prompt to define inputs.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {vars.map(v => (
                                <div key={v} className="space-y-1.5">
                                  <label className="block font-mono text-[10px] text-pc-muted uppercase">{v}</label>
                                  <textarea 
                                    value={tc.variables[v] || ""}
                                    onChange={(e) => updateTestCaseVariable(tc.id, v, e.target.value)}
                                    className="w-full bg-pc-bg border border-pc-border2 rounded-lg p-3 font-mono text-[12px] text-pc-text outline-none focus:border-pc-accent transition-colors resize-none"
                                    rows={2}
                                    placeholder={`Value for {{${v}}}`}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* EXPECTED OUTPUT */}
                        <div className="space-y-4">
                          <div className="font-mono text-[10px] tracking-widest text-pc-hint uppercase">Expected Output</div>
                          <textarea 
                            value={tc.expectedOutput || ""}
                            onChange={(e) => updateTestCaseExpected(tc.id, e.target.value)}
                            className="w-full bg-pc-bg border border-pc-border2 rounded-lg p-3 font-mono text-[12px] text-pc-text outline-none focus:border-pc-accent transition-colors resize-none h-[200px]"
                            placeholder="What do you expect the model to return?"
                          />
                        </div>

                        {/* OUTPUT */}
                        <div className="space-y-4">
                          <div className="font-mono text-[10px] tracking-widest text-pc-hint uppercase flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span>Output</span>
                              {tc.output && tc.expectedOutput && (
                                <button 
                                  onClick={() => toggleTestCaseDiff(tc.id)}
                                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-all ${tc.showDiff ? "bg-pc-accent/10 border-pc-accent text-pc-accent" : "border-pc-border2 text-pc-hint hover:border-pc-accent"}`}
                                >
                                  DIFF
                                </button>
                              )}
                            </div>
                            {tc.output && (
                              <button 
                                onClick={() => {
                                  navigator.clipboard.writeText(tc.output);
                                }}
                                className="hover:text-pc-accent transition-colors"
                              >
                                <Copy size={12} />
                              </button>
                            )}
                          </div>
                          <div className={`w-full min-h-[120px] bg-pc-bg border border-pc-border2 rounded-lg p-4 font-mono text-[12px] leading-relaxed overflow-y-auto max-h-[300px] ${tc.error ? "text-pc-red bg-pc-red/5 border-pc-red/20" : tc.output ? "text-pc-text" : "text-pc-hint italic"}`}>
                            {tc.isLoading ? (
                              <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
                                <Loader2 size={24} className="animate-spin text-pc-accent" />
                                <span className="animate-pulse">Generating response...</span>
                              </div>
                            ) : tc.error ? (
                              <div className="flex items-start gap-2">
                                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                <span>{tc.error}</span>
                              </div>
                            ) : tc.output ? (
                              tc.showDiff && tc.expectedOutput ? (
                                <DiffViewer expected={tc.expectedOutput} actual={tc.output} />
                              ) : (
                                <div className="whitespace-pre-wrap">{tc.output}</div>
                              )
                            ) : (
                              "Run test to see output..."
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {testCases.length > 0 && (
                  <div className="flex justify-center pt-4">
                    <button 
                      onClick={() => {
                        if (confirm("Reset all test cases?")) {
                          setTestCases([{ id: crypto.randomUUID(), variables: {}, output: "", isLoading: false, error: null }]);
                        }
                      }}
                      className="text-pc-hint hover:text-pc-red font-mono text-[11px] flex items-center gap-2 transition-colors"
                    >
                      <RotateCcw size={12} /> Reset all tests
                    </button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
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
                        onClick={() => loadHistoryItem(item, "history")}
                        className={`group bg-pc-bg3 border rounded-xl p-4 transition-all cursor-pointer relative ${activeItemId === item.id ? "border-pc-accent" : "border-pc-border2 hover:border-pc-accent"}`}
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
                        className={`group bg-pc-bg3 border rounded-xl p-4 transition-all relative ${activeItemId === item.id ? "border-pc-accent" : "border-pc-border2 hover:border-pc-accent"}`}
                      >
                        <div 
                          onClick={() => loadHistoryItem(item, "library")}
                          className="cursor-pointer"
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
                          <p className="text-[11px] text-pc-muted font-mono line-clamp-2 italic mb-3">
                            "{item.result.one_line_verdict}"
                          </p>
                        </div>

                        {/* Versions */}
                        {item.versions && item.versions.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-pc-border space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                              <RotateCcw size={12} className="text-pc-hint" />
                              <span className="text-[9px] font-mono text-pc-hint uppercase tracking-widest">Version History</span>
                            </div>
                            <div className="space-y-1.5">
                              {item.versions.map((v) => (
                                <div 
                                  key={v.id}
                                  onClick={() => loadHistoryItem(v, "library")}
                                  className="flex items-center justify-between p-2 rounded bg-pc-bg/50 hover:bg-pc-bg transition-all cursor-pointer group/v"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[11px] font-bold font-mono ${getScoreColorClass(v.result.overall_score)}`}>
                                      {v.result.overall_score}
                                    </span>
                                    <span className="text-[9px] text-pc-hint font-mono">
                                      {new Date(v.timestamp).toLocaleString()}
                                    </span>
                                  </div>
                                  <span className="text-[9px] text-pc-accent opacity-0 group-hover/v:opacity-100 transition-all font-mono">REVERT</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
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

      {/* Templates Modal */}
      <AnimatePresence>
        {showTemplates && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTemplates(false)}
              className="absolute inset-0 bg-pc-bg/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-4xl bg-pc-bg2 border border-pc-border rounded-2xl shadow-2xl flex flex-col max-h-[85vh] relative z-10"
            >
              <div className="flex items-center justify-between p-6 border-b border-pc-border">
                <div className="flex items-center gap-2">
                  <Zap className="text-pc-accent" size={20} />
                  <h3 className="text-xl font-bold">Prompt Templates</h3>
                </div>
                <button 
                  onClick={() => setShowTemplates(false)}
                  className="p-2 hover:bg-pc-bg3 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Predefined Templates */}
                <div className="space-y-4">
                  <h4 className="font-mono text-[10px] tracking-widest text-pc-hint uppercase">Predefined Blueprints</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {PREDEFINED_TEMPLATES.map(template => (
                      <div 
                        key={template.id}
                        onClick={() => loadHistoryItem(template, "template")}
                        className="group bg-pc-bg3 border border-pc-border2 rounded-xl p-5 hover:border-pc-accent transition-all cursor-pointer relative"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-mono text-pc-accent uppercase tracking-wider mb-1">{template.category}</span>
                            <span className="text-[14px] font-bold">{template.name}</span>
                          </div>
                          <ChevronRight size={16} className="text-pc-hint group-hover:text-pc-accent transition-colors" />
                        </div>
                        <p className="text-[11px] text-pc-muted leading-relaxed line-clamp-2">
                          {template.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Custom Templates */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-mono text-[10px] tracking-widest text-pc-hint uppercase">Your Custom Templates</h4>
                    {customTemplates.length > 0 && (
                      <button 
                        onClick={() => {
                          if (confirm("Clear all custom templates?")) {
                            setCustomTemplates([]);
                            localStorage.removeItem("promptcraft_custom_templates");
                          }
                        }}
                        className="font-mono text-[9px] text-pc-red uppercase tracking-widest hover:underline"
                      >
                        clear all
                      </button>
                    )}
                  </div>
                  
                  {customTemplates.length === 0 ? (
                    <div className="bg-pc-bg/30 border border-dashed border-pc-border2 rounded-xl p-8 text-center">
                      <p className="text-[12px] text-pc-hint font-mono">
                        No custom templates yet. Save your current prompt as a template to see it here.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {customTemplates.map(template => (
                        <div 
                          key={template.id}
                          className={`group bg-pc-bg3 border rounded-xl p-5 transition-all relative ${activeItemId === template.id ? "border-pc-accent" : "border-pc-border2 hover:border-pc-accent"}`}
                        >
                          <div 
                            onClick={() => loadHistoryItem(template, "template")}
                            className="cursor-pointer"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex flex-col">
                                <span className="text-[14px] font-bold">{template.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={(e) => deleteCustomTemplate(template.id, e)}
                                  className="p-1.5 text-pc-hint hover:text-pc-red transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 size={14} />
                                </button>
                                <ChevronRight size={16} className="text-pc-hint group-hover:text-pc-accent transition-colors" />
                              </div>
                            </div>
                            <p className="text-[11px] text-pc-muted leading-relaxed line-clamp-2 mb-3">
                              {template.description}
                            </p>
                          </div>

                          {/* Versions */}
                          {template.versions && template.versions.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-pc-border space-y-2">
                              <div className="flex items-center gap-2 mb-2">
                                <RotateCcw size={12} className="text-pc-hint" />
                                <span className="text-[9px] font-mono text-pc-hint uppercase tracking-widest">Version History</span>
                              </div>
                              <div className="space-y-1.5">
                                {template.versions.map((v) => (
                                  <div 
                                    key={v.id}
                                    onClick={() => loadHistoryItem(v, "template")}
                                    className="flex items-center justify-between p-2 rounded bg-pc-bg/50 hover:bg-pc-bg transition-all cursor-pointer group/v"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-[9px] text-pc-hint font-mono">
                                        {new Date(v.timestamp).toLocaleString()}
                                      </span>
                                    </div>
                                    <span className="text-[9px] text-pc-accent opacity-0 group-hover/v:opacity-100 transition-all font-mono">REVERT</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 border-t border-pc-border bg-pc-bg/30">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <Save size={14} className="text-pc-accent" />
                    <span className="text-[11px] font-bold uppercase tracking-wider">Save Current as Template</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr_auto] gap-3">
                    <input 
                      id="tpl-name"
                      type="text"
                      placeholder="Template Name (e.g. Blog Post Draft)"
                      className="bg-pc-bg border border-pc-border2 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:border-pc-accent transition-all"
                    />
                    <input 
                      id="tpl-desc"
                      type="text"
                      placeholder="Short description..."
                      className="bg-pc-bg border border-pc-border2 rounded-lg px-3 py-2 text-[12px] focus:outline-none focus:border-pc-accent transition-all"
                    />
                    <button 
                      onClick={() => {
                        const name = (document.getElementById('tpl-name') as HTMLInputElement).value;
                        const desc = (document.getElementById('tpl-desc') as HTMLInputElement).value;
                        if (!name) return alert("Please enter a template name.");
                        saveAsTemplate(name, desc);
                        (document.getElementById('tpl-name') as HTMLInputElement).value = "";
                        (document.getElementById('tpl-desc') as HTMLInputElement).value = "";
                      }}
                      className="bg-pc-accent text-pc-bg px-6 py-2 rounded-lg font-bold text-[12px] hover:opacity-90 transition-all"
                    >
                      Save Template
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* User Manual Modal */}
      <AnimatePresence>
        {showManual && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowManual(false)}
              className="absolute inset-0 bg-pc-bg/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-3xl bg-pc-bg2 border border-pc-border rounded-2xl shadow-2xl flex flex-col max-h-[85vh] relative z-10"
            >
              <div className="flex items-center justify-between p-6 border-b border-pc-border">
                <div className="flex items-center gap-6">
                  <button 
                    onClick={() => setManualTab("guide")}
                    className={`flex items-center gap-2 pb-1 border-b-2 transition-all ${manualTab === "guide" ? "border-pc-accent text-pc-text" : "border-transparent text-pc-hint hover:text-pc-muted"}`}
                  >
                    <HelpCircle size={18} />
                    <span className="text-lg font-bold">User Manual</span>
                  </button>
                  <button 
                    onClick={() => setManualTab("roadmap")}
                    className={`flex items-center gap-2 pb-1 border-b-2 transition-all ${manualTab === "roadmap" ? "border-pc-accent text-pc-text" : "border-transparent text-pc-hint hover:text-pc-muted"}`}
                  >
                    <Compass size={18} />
                    <span className="text-lg font-bold">PE Roadmap</span>
                  </button>
                </div>
                <button 
                  onClick={() => setShowManual(false)}
                  className="p-2 hover:bg-pc-bg3 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {manualTab === "guide" ? (
                  <div className="space-y-10">
                    {/* Section 1: The Builder */}
                    <section className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-pc-accent/10 flex items-center justify-center text-pc-accent">
                          <Layers size={18} />
                        </div>
                        <h4 className="text-lg font-bold">1. The Builder Mode</h4>
                      </div>
                      <p className="text-[13px] text-pc-muted leading-relaxed">
                        The Builder uses a 6-step structured approach to help you craft high-performance prompts. Each step focuses on a critical dimension of prompt engineering:
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {[
                          { title: "Role", desc: "Define WHO the AI is (e.g., 'Senior Software Engineer')." },
                          { title: "Task", desc: "Clearly state WHAT the AI should do." },
                          { title: "Context", desc: "Provide background info and the 'Why'." },
                          { title: "Format", desc: "Specify the structure of the output (JSON, Markdown, etc.)." },
                          { title: "Example", desc: "Give a few-shot example of the desired output." },
                          { title: "Constraints", desc: "Set boundaries on what NOT to do." }
                        ].map(item => (
                          <div key={item.title} className="bg-pc-bg3 p-3 rounded-xl border border-pc-border2">
                            <span className="text-[11px] font-bold text-pc-accent uppercase tracking-wider block mb-1">{item.title}</span>
                            <p className="text-[11px] text-pc-muted">{item.desc}</p>
                          </div>
                        ))}
                      </div>
                    </section>

                    {/* Section 2: Variables */}
                    <section className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-pc-accent2/10 flex items-center justify-center text-pc-accent2">
                          <Variable size={18} />
                        </div>
                        <h4 className="text-lg font-bold">2. Dynamic Variables</h4>
                      </div>
                      <p className="text-[13px] text-pc-muted leading-relaxed">
                        Make your prompts reusable by using the <code className="bg-pc-bg3 px-1.5 py-0.5 rounded text-pc-accent font-mono">{"{{variable_name}}"}</code> syntax.
                      </p>
                      <div className="bg-pc-bg3 p-4 rounded-xl border border-pc-border2 font-mono text-[11px]">
                        <span className="text-pc-hint">// Example:</span><br/>
                        Summarise the following article for a <span className="text-pc-accent">{"{{target_audience}}"}</span>:<br/>
                        <span className="text-pc-accent">{"{{article_text}}"}</span>
                      </div>
                      <p className="text-[12px] text-pc-hint italic">
                        PromptCraft automatically detects these variables and generates input fields in the Tester view.
                      </p>
                    </section>

                    {/* Section 3: The Tester */}
                    <section className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-pc-amber/10 flex items-center justify-center text-pc-amber">
                          <Terminal size={18} />
                        </div>
                        <h4 className="text-lg font-bold">3. The Tester View</h4>
                      </div>
                      <p className="text-[13px] text-pc-muted leading-relaxed">
                        Switch to the Tester to run your prompt against real inputs. You can create multiple test cases, provide values for your variables, and compare the AI's output against your "Expected Output" using the built-in <span className="font-bold">DIFF</span> tool.
                      </p>
                    </section>

                    {/* Section 4: Grading & Weights */}
                    <section className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-pc-red/10 flex items-center justify-center text-pc-red">
                          <Sliders size={18} />
                        </div>
                        <h4 className="text-lg font-bold">4. Grading & Custom Weights</h4>
                      </div>
                      <p className="text-[13px] text-pc-muted leading-relaxed">
                        Click "Grade my prompt" to get an objective evaluation from Gemini. You can customise the grading criteria in the <span className="font-bold">Weights</span> menu. Add your own dimensions or adjust the importance of existing ones to match your specific needs.
                      </p>
                    </section>
                  </div>
                ) : (
                  <div className="space-y-12 py-4">
                    <div className="text-center max-w-lg mx-auto mb-12">
                      <h4 className="text-2xl font-bold mb-3">Prompt Engineering Roadmap</h4>
                      <p className="text-[13px] text-pc-hint">A structured path to mastering the art of AI communication and becoming an industry-standard specialist.</p>
                    </div>

                    <div className="relative space-y-16">
                      {/* Vertical Line */}
                      <div className="absolute left-6 top-4 bottom-4 w-[2px] bg-pc-border2" />

                      {[
                        {
                          step: "01",
                          title: "Foundations & Mechanics",
                          desc: "Understand how LLMs actually work. Learn about tokens, context windows, and the probabilistic nature of AI responses. Master the difference between completion and instruction-tuned models.",
                          icon: <Zap size={20} />,
                          color: "bg-pc-accent"
                        },
                        {
                          step: "02",
                          title: "Structural Architecture",
                          desc: "Learn to build prompts as modular systems. Master the 6-pillar framework (Role, Task, Context, Format, Examples, Constraints). This is the 'grammar' of professional prompt engineering.",
                          icon: <Layers size={20} />,
                          color: "bg-pc-accent2"
                        },
                        {
                          step: "03",
                          title: "Advanced Reasoning Patterns",
                          desc: "Move beyond simple instructions. Implement Chain-of-Thought (CoT) for logic, Few-Shot prompting for pattern matching, and Least-to-Most decomposition for complex problem solving.",
                          icon: <Brain size={20} />,
                          color: "bg-pc-amber"
                        },
                        {
                          step: "04",
                          title: "Iterative Testing & Validation",
                          desc: "Professional engineering is about data, not vibes. Learn to create robust test suites, use dynamic variables, and objectively compare outputs using diffing and semantic similarity.",
                          icon: <Terminal size={20} />,
                          color: "bg-pc-accent"
                        },
                        {
                          step: "05",
                          title: "Evaluation Frameworks",
                          desc: "Develop custom scoring systems. Learn to use LLMs as judges (LLM-as-a-Judge) to grade outputs based on specific dimensions like accuracy, tone, safety, and conciseness.",
                          icon: <Sliders size={20} />,
                          color: "bg-pc-red"
                        },
                        {
                          step: "06",
                          title: "Industry Standards & Security",
                          desc: "The final level. Master prompt injection defense, cost optimization (token reduction), and building scalable prompt pipelines for production environments.",
                          icon: <Shield size={20} />,
                          color: "bg-pc-accent2"
                        }
                      ].map((item, idx) => (
                        <div key={idx} className="relative flex gap-8 group">
                          <div className={`w-12 h-12 rounded-2xl ${item.color} flex items-center justify-center text-pc-bg shadow-lg z-10 shrink-0 group-hover:scale-110 transition-transform`}>
                            {item.icon}
                          </div>
                          <div className="space-y-2 pt-1">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-[11px] font-bold text-pc-accent">{item.step}</span>
                              <h5 className="text-lg font-bold">{item.title}</h5>
                            </div>
                            <p className="text-[13px] text-pc-muted leading-relaxed max-w-xl">
                              {item.desc}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-pc-border flex justify-center">
                <button 
                  onClick={() => setShowManual(false)}
                  className="px-10 py-3 bg-pc-accent text-pc-bg font-bold rounded-xl hover:opacity-90 transition-all"
                >
                  Got it, let's craft!
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
