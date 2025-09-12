import { createExample, getExamples } from "../../services/example";
import { Examples } from "../../templates/examples";
import { redirect, render } from "../../utils/response";

export const examples = {
  async index(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const success = url.searchParams.get("success") === "true";
    const examples = await getExamples();
    return render(<Examples examples={examples} success={success} />);
  },

  async create(req: Request): Promise<Response> {
    const formData = await req.formData();
    const name = formData.get("name") as string;

    // Early return for validation failures
    if (!name || name.trim().length < 2) {
      return redirect("/examples");
    }

    // Happy path - successful form submission
    await createExample(name.trim());
    return redirect("/examples?success=true");
  },
};
