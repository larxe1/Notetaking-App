export async function callGemini(apiKey, systemInstruction, prompt, schema = null, maxRetries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
  
  const payload = {
    system_instruction: {
      parts: [{ text: systemInstruction }]
    },
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.2
    }
  };

  if (schema) {
    payload.generationConfig.response_mime_type = "application/json";
    payload.generationConfig.response_schema = schema;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let err = 'API Error';
        try { const data = await res.json(); err = data.error?.message || err; } catch {}
        
        if ((res.status === 503 || res.status === 429) && attempt < maxRetries) {
          throw new Error(`RETRY: ${err}`);
        }
        throw new Error(err);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Empty response from AI");
      
      if (schema) {
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error("Invalid JSON returned by AI");
        }
      }
      
      return text;
      
    } catch (err) {
      if (err.message.startsWith('RETRY:') && attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 2000;
        console.warn(`Gemini API busy (attempt ${attempt + 1}). Retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw new Error(err.message.replace('RETRY: ', ''));
      }
    }
  }
}

export async function generateMCQ(pdfText, apiKey, topic = "") {
  let sys = `You are a strict, brilliant law professor. Generate exactly 5 highly analytical multiple-choice questions based on the provided text.`;
  if (topic) sys += ` Ensure the questions specifically focus on the following topic(s): ${topic}.`;
  const schema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        question: { type: "STRING", description: "The quiz question" },
        options: { 
          type: "ARRAY", 
          items: { type: "STRING" },
          description: "Exactly 4 multiple choice options" 
        },
        correct_index: { type: "INTEGER", description: "0-based index of the correct option" }
      },
      required: ["question", "options", "correct_index"]
    }
  };
  
  return await callGemini(apiKey, sys, `Based strictly on the following text, generate a 5-question quiz.\n\nTEXT:\n${pdfText}`, schema);
}

export async function generateEssayQuestion(pdfText, apiKey, topic = "") {
  let sys = `You are a strict, brilliant law professor. Generate 1 highly complex, deep-thinking open-ended essay question based strictly on the text provided. The question should require critical analysis and legal reasoning. Do not output anything other than the question itself.`;
  if (topic) sys += ` Ensure the essay question specifically focuses on the following topic(s): ${topic}.`;
  return await callGemini(apiKey, sys, `TEXT:\n${pdfText}`);
}

export async function gradeEssay(pdfText, question, studentAnswer, apiKey) {
  const sys = `You are a strict, uncompromising law professor who does not coddle students. Grade the student's answer based on the provided source text and the question asked. 
Be brutally critical, point out legal inaccuracies, structural flaws, and weak reasoning. Give a final grade out of 100.`;
  
  const schema = {
    type: "OBJECT",
    properties: {
      grade: { type: "STRING", description: "e.g., '65/100'" },
      critique: { type: "STRING", description: "Your brutal, uncompromising feedback" }
    },
    required: ["grade", "critique"]
  };
  
  const prompt = `SOURCE TEXT:\n${pdfText}\n\nQUESTION:\n${question}\n\nSTUDENT'S ANSWER:\n${studentAnswer}`;
  return await callGemini(apiKey, sys, prompt, schema);
}
