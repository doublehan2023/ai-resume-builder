const SectionHeading = ({ children, accentColor }) => (
  <h2
    className="mb-3 border-b pb-1.5 text-xs font-bold uppercase tracking-[0.18em]"
    style={{ borderColor: accentColor, color: accentColor }}
  >
    {children}
  </h2>
);

const TechTemplate = ({ data, accentColor }) => {
  const personalInfo = data.personal_info || {};

  const formatDate = (dateString) => {
    if (!dateString) return "";

    const [year, month] = dateString.split("-");
    if (!year || !month) return dateString;

    return new Date(Number(year), Number(month) - 1).toLocaleDateString(
      "en-US",
      { year: "numeric", month: "short" },
    );
  };

  const contactDetails = [
    personalInfo.email,
    personalInfo.phone,
    personalInfo.location,
    personalInfo.linkedin,
    personalInfo.website,
  ].filter(Boolean);

  return (
    <article className="mx-auto max-w-4xl bg-white p-8 text-[13px] leading-relaxed text-slate-800 sm:p-10">
      <header className="mb-7 border-b-2 pb-5" style={{ borderColor: accentColor }}>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          {personalInfo.full_name || "Your Name"}
        </h1>
        {personalInfo.profession && (
          <p className="mt-1 text-sm font-semibold" style={{ color: accentColor }}>
            {personalInfo.profession}
          </p>
        )}
        {contactDetails.length > 0 && (
          <p className="mt-3 break-words text-xs text-slate-600">
            {contactDetails.join("  |  ")}
          </p>
        )}
      </header>

      {data.professional_summary && (
        <section className="mb-6">
          <SectionHeading accentColor={accentColor}>Summary</SectionHeading>
          <p className="whitespace-pre-line text-slate-700">
            {data.professional_summary}
          </p>
        </section>
      )}

      {data.experience?.length > 0 && (
        <section className="mb-6">
          <SectionHeading accentColor={accentColor}>Experience</SectionHeading>
          <div className="space-y-5">
            {data.experience.map((experience, index) => (
              <div key={`${experience.company}-${experience.position}-${index}`}>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <div>
                    <h3 className="font-bold text-slate-950">{experience.position}</h3>
                    {experience.company && (
                      <p className="font-semibold" style={{ color: accentColor }}>
                        {experience.company}
                      </p>
                    )}
                  </div>
                  {(experience.start_date || experience.end_date || experience.is_current) && (
                    <p className="shrink-0 text-xs font-medium text-slate-500">
                      {formatDate(experience.start_date)}
                      {experience.start_date && " – "}
                      {experience.is_current ? "Present" : formatDate(experience.end_date)}
                    </p>
                  )}
                </div>
                {experience.description && (
                  <p className="mt-1.5 whitespace-pre-line text-slate-700">
                    {experience.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.project?.length > 0 && (
        <section className="mb-6">
          <SectionHeading accentColor={accentColor}>Projects</SectionHeading>
          <div className="space-y-4">
            {data.project.map((project, index) => (
              <div key={`${project.name}-${index}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 className="font-bold text-slate-950">{project.name}</h3>
                  {project.type && <span className="text-xs text-slate-500">{project.type}</span>}
                </div>
                {project.description && (
                  <p className="mt-1 whitespace-pre-line text-slate-700">
                    {project.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.skills?.length > 0 && (
        <section className="mb-6">
          <SectionHeading accentColor={accentColor}>Technical Skills</SectionHeading>
          <p className="text-slate-700">{data.skills.join("  •  ")}</p>
        </section>
      )}

      {data.education?.length > 0 && (
        <section>
          <SectionHeading accentColor={accentColor}>Education</SectionHeading>
          <div className="space-y-3">
            {data.education.map((education, index) => (
              <div
                className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between"
                key={`${education.institution}-${education.degree}-${index}`}
              >
                <div>
                  <h3 className="font-bold text-slate-950">
                    {education.degree}
                    {education.field && ` in ${education.field}`}
                  </h3>
                  {education.institution && <p className="text-slate-700">{education.institution}</p>}
                  {education.gpa && <p className="text-xs text-slate-500">GPA: {education.gpa}</p>}
                </div>
                {education.graduation_date && (
                  <p className="shrink-0 text-xs font-medium text-slate-500">
                    {formatDate(education.graduation_date)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
};

export default TechTemplate;
