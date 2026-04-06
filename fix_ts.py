import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Remove generateSimilarQuestions function
content = re.sub(r'const generateSimilarQuestions = async \(q: Question\) => \{.*?setUploadStatus\(\'\'\);\s*\}\s*\};\s*', '', content, flags=re.DOTALL)

# Remove calls to generateSimilarQuestions
content = re.sub(r'<Button \s*variant="ghost" \s*className="mt-2 text-xs"\s*onClick=\{\(\) => practiceQuestion && generateSimilarQuestions\(practiceQuestion\)\}\s*>\s*Generate with AI\s*</Button>', '', content, flags=re.DOTALL)
content = re.sub(r'<Button variant="ghost" className="text-xs h-8" onClick=\{\(\) => practiceQuestion && generateSimilarQuestions\(practiceQuestion\)\}>\s*<Sparkles className="w-3 h-3" />\s*Generate Similar\s*</Button>', '', content, flags=re.DOTALL)


# Remove Upload a Paper First button
content = re.sub(r'<Button variant="primary" icon=\{Upload\} onClick=\{\(\) => setActiveTab\(\'upload\'\)\}>Upload a Paper First</Button>', '', content, flags=re.DOTALL)

with open('src/App.tsx', 'w') as f:
    f.write(content)

print("Fixed TS errors")
