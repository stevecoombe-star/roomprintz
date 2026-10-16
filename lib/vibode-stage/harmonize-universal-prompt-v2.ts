/**
 * HARMONIZE Universal Prompt V2.0.
 *
 * Approved wording, installed verbatim. Do not paraphrase, shorten, or edit it.
 */
export const HARMONIZE_UNIVERSAL_PROMPT_VERSION = "harmonize-universal-prompt/2.0" as const;

export const HARMONIZE_UNIVERSAL_PROMPT_V2 = `**TASK: Photorealistic Furniture Harmonization**

Perform precise photographic harmonization of the digitally inserted furniture and interior objects already present in the supplied image.

The furniture arrangement, room composition, camera perspective, and object placement are complete and authoritative.

This is a photographic integration task, NOT an interior design, furniture generation, room renovation, or scene reconstruction task.

**PRIMARY OBJECTIVE**

Make all inserted furniture and interior objects appear naturally photographed within the existing room, as though they were physically present when the original photograph was taken.

Preserve the exact composition while improving only the photographic integration of the inserted objects.

**LIGHTING AND COLOR HARMONIZATION**

Analyze the existing room environment to infer its illumination, including natural and artificial light sources, direction, intensity, softness, color temperature, reflected light, and ambient conditions.

Harmonize the inserted objects by appropriately adjusting:

- Illumination, exposure, contrast, and tonal balance.
- White balance and environmental color casts.
- Directional shading, highlights, and reflected light.
- Material-specific light response and surface appearance.
- Ambient occlusion and subtle environmental light interaction.
- Photographic sharpness, grain, noise, and image texture where necessary.

Respect the existing room's lighting conditions, including daylight, artificial lighting, mixed lighting, and low-light environments.

Preserve each object's original product identity, geometry, base color, material, texture, and distinctive design details.

**PHYSICALLY PLAUSIBLE SHADOWS AND GROUNDING**

Generate realistic contact and cast shadows consistent with the room's existing lighting and the position of each inserted object.

Account for the visible floor and surrounding surfaces, including their materials, texture, reflectivity, and illumination.

Apply appropriate grounding and light interaction wherever inserted objects contact floors, walls, furniture, or other surfaces.

Respect the physical characteristics of each object and its relationship with neighboring objects.

Shadows must be naturally integrated, with appropriate direction, softness, density, and falloff.

Do not introduce exaggerated shadows, artificial halos, or inconsistent illumination.

**STRICT OBJECT AND GEOMETRY PRESERVATION**

Treat the existing inserted objects as authoritative.

Preserve exactly:

- Number and identity of objects.
- Position, orientation, and arrangement.
- Apparent size, scale, and proportions.
- Camera perspective and projected geometry.
- Silhouettes, contours, and structural details.
- Original product colors and material identity.
- Surface textures, patterns, and distinctive features.
- Relative spacing, overlap, and visible occlusion relationships.

Do not move, rotate, resize, replace, remove, duplicate, redesign, deform, or reconstruct any furniture or object.

Do not invent new furniture, decorative elements, or structural features.

**STRICT ROOM AND BACKGROUND PRESERVATION**

Preserve the existing room photograph and all its contents.

Do not alter the room's architecture, layout, flooring, walls, ceilings, doors, windows, fixtures, existing furniture, decorations, clutter, or other background elements.

Do not clean, declutter, renovate, restyle, rearrange, beautify, relight, or reconstruct the room.

Preserve the original photographic framing, perspective, aspect ratio, and composition.

Only modify background regions where physically necessary to integrate the inserted objects through realistic shadows, reflections, ambient occlusion, or subtle light interaction.

**PHOTOGRAPHIC REALISM**

Ensure the inserted objects share the visual characteristics of the surrounding photograph.

Match the environment's photographic tone, sharpness, depth characteristics, dynamic range, and image texture without unnecessarily modifying the background.

Avoid artificial CGI appearance, excessive smoothing, exaggerated contrast, oversaturation, or stylized rendering.

The integration should be physically plausible, subtle where appropriate, and visually seamless.

**FINAL OUTPUT**

Return one photorealistic image preserving the exact original room and furniture arrangement.

Every inserted object must appear naturally integrated into the existing environment through coherent lighting, shadows, color, tone, reflections, and photographic consistency.

Do not redesign the scene. Do not change the furniture. Do not change the room.

The final image should look like an authentic photograph of the exact supplied composition, with the inserted objects physically present in the room.`;
