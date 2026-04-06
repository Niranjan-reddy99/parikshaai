import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# 1. Remove GenAI imports and init
content = re.sub(r'import \{ GoogleGenAI, Type \} from "@google/genai";\s*// Initialize Gemini.*?return new GoogleGenAI\(\{ apiKey \}\);\s*};\s*', '', content, flags=re.DOTALL)

# 2. Replace activeTab definition
content = content.replace(
    "const [activeTab, setActiveTab] = useState<'dashboard' | 'questions' | 'upload' | 'practice' | 'exam' | 'report'>('dashboard');",
    "const [activeTab, setActiveTab] = useState<'dashboard' | 'questions' | 'practice' | 'exam' | 'report'>('dashboard');"
)

# 3. Remove uploading states
content = content.replace("const [uploading, setUploading] = useState(false);\n  const [uploadStatus, setUploadStatus] = useState<string | null>(null);\n", "")

# 4. Replace useEffect data fetching
old_use_effect = r"// --- Data Fetching ---.*?return \(\) => \{\s*unsubQuestions\(\);\s*unsubExams\(\);\s*\};\s*\}, \[user\]\);"
new_use_effect = """// --- Data Fetching ---
  useEffect(() => {
    if (!user) return;
    
    let isMounted = true;
    const fetchData = async () => {
      try {
        setLoading(true);
        const [qRes, sRes] = await Promise.all([
          fetch('http://localhost:8000/questions?limit=100'),
          fetch('http://localhost:8000/stats')
        ]);
        
        if (!isMounted) return;
        
        if (qRes.ok) {
          const qData = await qRes.json();
          setQuestions(qData.questions || []);
          setGlobalError(null);
        }
        
        if (sRes.ok) {
          const sData = await sRes.json();
          const mockExams = (sData.exam_names || []).map((name: string, i: number) => ({
            id: String(i),
            name,
            year: sData.exam_years[i % sData.exam_years.length] || 2024,
            totalQuestions: 100,
            processedAt: new Date().toISOString()
          }));
          setExams(mockExams);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error("Failed to fetch from backend", err);
          setGlobalError("Could not connect to the backend server.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchData();
    return () => { isMounted = false; };
  }, [user]);"""
content = re.sub(old_use_effect, new_use_effect, content, flags=re.DOTALL)

# 5. Remove handleFileUpload
content = re.sub(r'const handleFileUpload = async \(.*?setUploading\(false\);\s*\}\s*\};', '', content, flags=re.DOTALL)

# 6. Remove Sidebar upload button
content = re.sub(r'<Button \s*variant=\{activeTab === \'upload\' \? \'primary\' : \'ghost\'\}\s*className="w-full justify-start"\s*icon=\{Upload\}\s*onClick=\{\(\) => setActiveTab\(\'upload\'\)\}\s*>\s*Upload PYQs\s*</Button>', '', content, flags=re.DOTALL)

# 7. Remove 'Upload New Paper' header button
content = re.sub(r'\{activeTab !== \'upload\' && \(\s*<Button variant="primary" icon=\{Upload\} onClick=\{\(\) => setActiveTab\(\'upload\'\)\}>\s*Upload New Paper\s*</Button>\s*\)\}', '', content, flags=re.DOTALL)

# 8. Remove activeTab titles for upload
content = re.sub(r'\{activeTab === \'upload\' && "Upload Documents"\}\n\s*', '', content)
content = re.sub(r'\{activeTab === \'upload\' && "Add new PDF papers to the engine."\}\n\s*', '', content)

# 9. Remove Upload empty state button
content = re.sub(r'<Button \s*variant="primary" \s*className="mt-6" \s*onClick=\{\(\) => setActiveTab\(\'upload\'\)\}\s*>\s*Upload Now\s*</Button>', '', content, flags=re.DOTALL)

# 10. Remove activeTab === 'upload' UI block
content = re.sub(r"\{activeTab === 'upload' && \(.*?(?=\{activeTab === 'report' && \()", "", content, flags=re.DOTALL)

with open('src/App.tsx', 'w') as f:
    f.write(content)

print("Done refactoring App.tsx")
