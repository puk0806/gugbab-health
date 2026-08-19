import { ulid } from "ulid";
import { getDB } from "./index";
import type { Ingredient } from "./types";

export async function getAllIngredients(): Promise<Ingredient[]> {
    const db = await getDB();
    return db.getAllFromIndex("ingredients", "byAddedAt");
}

export async function addIngredient(name: string): Promise<Ingredient> {
    const db = await getDB();
    const ingredient: Ingredient = {
        id: ulid(),
        name,
        addedAt: new Date().toISOString(),
    };
    await db.put("ingredients", ingredient);
    return ingredient;
}

export async function deleteIngredient(id: string): Promise<void> {
    const db = await getDB();
    await db.delete("ingredients", id);
}
