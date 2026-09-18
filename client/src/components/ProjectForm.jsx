import { Plus, Trash } from "lucide-react";
import { isValidProjectLink } from "../utils/projectLinks";

const ProjectForm = ({ data = [], onChange }) => {
  const addProject = () => {
    const newProject = {
      name: "",
      type: "",
      link: "",
      description: "",
    };
    onChange([...data, newProject]);
  };

  const removeProject = (index) => {
    const updated = data.filter((_, i) => i !== index);
    onChange(updated);
  };

  const updateProject = (index, field, value) => {
    const updated = [...data];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h3
            className="flex items-center gap-2 text-lg font-semibold
               text-gray-900"
          >
            Project
          </h3>
          <p className="text-sm text-gray-500">Add your project</p>
        </div>
        <button
          type="button"
          onClick={addProject}
          className="flex items-center gap-2 px-3 py-1 text-sm bg-green-100
        text-green-700 rounded-lg hover:bg-green-200 transition-colors"
        >
          <Plus className="size-4" />
          Add Project
        </button>
      </div>

     
     <div className="space-y-4 mt-6">
        {data.map((project, index) => (
          <div
            key={index}
            className="p-4 border border-gray-200 rounded-lg
               space-y-3"
          >
            <div className="flex justify-between items-start">
              <h4>Project #{index + 1}</h4>
              <button
                type="button"
                onClick={() => removeProject(index)}
                aria-label={`Remove project ${index + 1}`}
                className="text-red-500 hover:text-red-700 transition-colors"
              >
                <Trash className="size-4" />
              </button>
            </div>

            <div className="grid gap-3">
              <input
                value={project.name || ""}
                onChange={(e) => updateProject(index, "name", e.target.value)}
                type="text"
                placeholder="Project Name"
                className="px-3 py-2 text-sm rounded-lg"
              />
              <input
                value={project.type || ""}
                onChange={(e) => updateProject(index, "type", e.target.value)}
                type="text"
                placeholder="Project Type"
                className="px-3 py-2 text-sm rounded-lg"
              />
              <div>
                <label
                  htmlFor={`project-link-${index}`}
                  className="mb-1 block text-sm font-medium text-gray-700"
                >
                  Project Link
                </label>
                <input
                  id={`project-link-${index}`}
                  value={project.link || ""}
                  onChange={(e) => updateProject(index, "link", e.target.value)}
                  type="url"
                  placeholder="https://github.com/you/project"
                  aria-invalid={Boolean(project.link) && !isValidProjectLink(project.link)}
                  className="w-full px-3 py-2 text-sm rounded-lg"
                />
                {project.link && !isValidProjectLink(project.link) && (
                  <p className="mt-1 text-xs text-red-600" role="alert">
                    Enter a complete URL beginning with http:// or https://.
                  </p>
                )}
              </div>

              <textarea
                rows={4}
                value={project.description || ""}
                onChange={(e) =>
                  updateProject(index, "description", e.target.value)
                }
                type="text"
                placeholder="Describe your project"
                className="w-full px-3 py-2 text-sm rounded-lg resize-none"
              />
            </div>
          </div>
        ))}
      </div>
     
    </div>
  );
};

export default ProjectForm;
